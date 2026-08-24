/**
 * OIDC(SSO ログイン)の下回り — ディスカバリ・JWKS・PKCE・トークン交換・ID トークン検証。
 * 仕様の正は docs/design/sso-oidc.md。ここには HTTP ルーティングもDBアクセスも置かない
 * (ルータは apps/api/src/routes/auth-oidc.ts)。
 *
 * ## なぜ `jose` を使うのか(依存追加の判断点、2026-08-24)
 *
 * ID トークンの署名検証は自前で書くものではない(alg 混同・`none` 受理・kid 選択ミスなど、
 * 素朴な実装が踏む落とし穴が多い)。`jose` は **WebCrypto のみに依存し workerd で動く**ため、
 * 要件 §8「コアはランタイム非依存」と将来の Cloudflare Workers 移植(v1.0)を壊さない。
 * node:crypto に依存する openid-client 等は同じ理由で採らなかった。
 *
 * ## ネットワークアクセスの注入
 *
 * ディスカバリ・JWKS 取得・トークン交換はすべて呼び出し側から渡された `fetchImpl` を通す。
 * テストは実 IdP に触れずローカルの偽 IdP(Hono アプリ)へ差し替える(要件: テストは
 * 実 IdP に接続しない)。`jose.createRemoteJWKSet` は自前で fetch するため使わず、
 * JWKS を自分で取得して `createLocalJWKSet` に渡す形にしてある(注入点を1つに保つため)。
 *
 * ## キャッシュ
 *
 * ディスカバリ文書と JWKS はプロセス内メモリに TTL 付きで持つ。lib/rate-limit.ts と同じく
 * **replicas=1 前提**の割り切りで、共有ストアは持たない(キャッシュミスは追加の HTTP 1本で
 * 済み、正しさには影響しない — レート制限と違ってプロセスが増えても壊れない)。
 */

import { createLocalJWKSet, jwtVerify, type JSONWebKeySet, type JWTPayload } from "jose";

/** ディスカバリ文書・JWKS のキャッシュ TTL(ミリ秒)。10分。 */
export const OIDC_CACHE_TTL_MS = 10 * 60_000;

/** ID トークンの時刻検証で許容するクロックずれ(秒)。 */
export const OIDC_CLOCK_TOLERANCE_SECONDS = 60;

/**
 * 受け入れる署名アルゴリズム。`none` と HMAC 系(HS*)を明示的に排除するための列挙
 * (公開鍵しか持たない以上 HS* は検証に失敗するが、alg 混同攻撃の芽を型で潰しておく)。
 */
const ALLOWED_ID_TOKEN_ALGS = ["RS256", "RS384", "RS512", "PS256", "PS384", "PS512", "ES256", "ES384", "ES512"];

/**
 * SSO の失敗理由。**そのまま `/login?error=<code>` のクエリになり、Web 側が4言語の文言へ
 * 対応付ける**(apps/web/src/lib/i18n/*.ts の `login.errors`)。増やしたら Web 側も足すこと。
 */
export type OidcErrorCode =
  | "sso_not_enabled"
  | "sso_config_incomplete"
  | "sso_discovery_failed"
  | "sso_token_failed"
  | "sso_invalid_token"
  | "sso_state_mismatch"
  | "sso_email_missing"
  | "sso_email_unverified"
  | "sso_user_not_found"
  | "sso_failed";

/** SSO 経路の想定内の失敗。`code` は利用者に見せてよい粒度までしか持たない(詳細は message とサーバーログのみ)。 */
export class OidcError extends Error {
  readonly code: OidcErrorCode;

  constructor(code: OidcErrorCode, message: string) {
    super(message);
    this.name = "OidcError";
    this.code = code;
  }
}

/** ディスカバリ文書のうち、この実装が使う項目だけ。 */
export interface OidcDiscovery {
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  jwksUri: string;
  /** IdP が受け付けるクライアント認証方式(未提供なら client_secret_post を仮定する)。 */
  tokenEndpointAuthMethods: readonly string[] | null;
}

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const discoveryCache = new Map<string, CacheEntry<OidcDiscovery>>();
const jwksCache = new Map<string, CacheEntry<JSONWebKeySet>>();

/** テスト用。プロセス内キャッシュを空にする(テスト間で偽 IdP を差し替えるため)。 */
export function clearOidcCaches(): void {
  discoveryCache.clear();
  jwksCache.clear();
}

export interface OidcNetworkDeps {
  /** 省略時はグローバル fetch。テストは偽 IdP へ差し替える。 */
  fetchImpl?: typeof fetch;
  /** 現在時刻(ミリ秒)。既定 Date.now。キャッシュ TTL の判定にのみ使う。 */
  nowMs?: () => number;
}

function resolveDeps(deps: OidcNetworkDeps | undefined): { fetchImpl: typeof fetch; nowMs: () => number } {
  return {
    fetchImpl: deps?.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args)),
    nowMs: deps?.nowMs ?? (() => Date.now()),
  };
}

/**
 * issuer を正規化する(末尾スラッシュを落とす)。ディスカバリ URL の組み立てと
 * ID トークンの `iss` 比較の双方で同じ表記を使うため、入口で1回だけ行う。
 */
export function normalizeIssuer(issuer: string): string {
  return issuer.replace(/\/+$/, "");
}

/** `{issuer}/.well-known/openid-configuration` を引く(TTL 付きキャッシュ)。 */
export async function discover(issuer: string, deps?: OidcNetworkDeps): Promise<OidcDiscovery> {
  const { fetchImpl, nowMs } = resolveDeps(deps);
  const normalized = normalizeIssuer(issuer);
  const now = nowMs();

  const cached = discoveryCache.get(normalized);
  if (cached && cached.expiresAt > now) return cached.value;

  const url = `${normalized}/.well-known/openid-configuration`;
  let res: Response;
  try {
    res = await fetchImpl(url, { method: "GET", headers: { accept: "application/json" } });
  } catch (cause) {
    throw new OidcError("sso_discovery_failed", `oidc discovery request failed: ${String(cause)}`);
  }
  if (!res.ok) {
    throw new OidcError("sso_discovery_failed", `oidc discovery returned ${res.status} for ${url}`);
  }

  let doc: Record<string, unknown>;
  try {
    doc = (await res.json()) as Record<string, unknown>;
  } catch {
    throw new OidcError("sso_discovery_failed", `oidc discovery returned non-JSON for ${url}`);
  }

  const authorizationEndpoint = doc.authorization_endpoint;
  const tokenEndpoint = doc.token_endpoint;
  const jwksUri = doc.jwks_uri;
  const docIssuer = doc.issuer;
  if (
    typeof authorizationEndpoint !== "string" ||
    typeof tokenEndpoint !== "string" ||
    typeof jwksUri !== "string" ||
    typeof docIssuer !== "string"
  ) {
    throw new OidcError("sso_discovery_failed", `oidc discovery document is missing required fields (${url})`);
  }
  // 設定された issuer とディスカバリ文書の issuer が食い違う場合は受け付けない
  // (OpenID Connect Discovery 1.0 §4.3 の要求。ここを緩めると、攻撃者が用意した
  // ディスカバリ文書で正規 IdP になりすませる)。
  if (normalizeIssuer(docIssuer) !== normalized) {
    throw new OidcError(
      "sso_discovery_failed",
      `oidc discovery issuer mismatch: configured=${normalized} document=${docIssuer}`,
    );
  }

  const methods = doc.token_endpoint_auth_methods_supported;
  const value: OidcDiscovery = {
    issuer: normalized,
    authorizationEndpoint,
    tokenEndpoint,
    jwksUri,
    tokenEndpointAuthMethods: Array.isArray(methods) ? methods.filter((m): m is string => typeof m === "string") : null,
  };
  discoveryCache.set(normalized, { value, expiresAt: now + OIDC_CACHE_TTL_MS });
  return value;
}

/** JWKS を取得する(TTL 付きキャッシュ)。`force` を立てると鍵ローテーション直後の再取得に使える。 */
export async function fetchJwks(jwksUri: string, deps?: OidcNetworkDeps, force = false): Promise<JSONWebKeySet> {
  const { fetchImpl, nowMs } = resolveDeps(deps);
  const now = nowMs();

  if (!force) {
    const cached = jwksCache.get(jwksUri);
    if (cached && cached.expiresAt > now) return cached.value;
  }

  let res: Response;
  try {
    res = await fetchImpl(jwksUri, { method: "GET", headers: { accept: "application/json" } });
  } catch (cause) {
    throw new OidcError("sso_discovery_failed", `jwks request failed: ${String(cause)}`);
  }
  if (!res.ok) {
    throw new OidcError("sso_discovery_failed", `jwks endpoint returned ${res.status} for ${jwksUri}`);
  }

  let doc: JSONWebKeySet;
  try {
    doc = (await res.json()) as JSONWebKeySet;
  } catch {
    throw new OidcError("sso_discovery_failed", `jwks endpoint returned non-JSON for ${jwksUri}`);
  }
  if (!Array.isArray(doc.keys)) {
    throw new OidcError("sso_discovery_failed", `jwks document has no "keys" array (${jwksUri})`);
  }

  jwksCache.set(jwksUri, { value: doc, expiresAt: now + OIDC_CACHE_TTL_MS });
  return doc;
}

// ---- 乱数・PKCE ------------------------------------------------------------

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

/** 32バイト乱数の base64url(state・nonce・code_verifier に使う。auth/session.ts と同じ流儀)。 */
export function randomToken(): string {
  const raw = new Uint8Array(32);
  crypto.getRandomValues(raw);
  return base64url(raw);
}

export interface Pkce {
  verifier: string;
  challenge: string;
  method: "S256";
}

/** PKCE(RFC 7636)の code_verifier / code_challenge を作る。S256 のみ(plain は使わない)。 */
export async function createPkce(): Promise<Pkce> {
  const verifier = randomToken();
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return { verifier, challenge: base64url(new Uint8Array(digest)), method: "S256" };
}

/**
 * 定数時間比較。state の照合に使う(比較対象は乱数なのでタイミング差から得られる情報は
 * 実質無いが、秘密値の比較は定数時間で書くという習慣を崩さない)。
 */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ---- 認可リクエスト --------------------------------------------------------

export interface AuthorizationUrlParams {
  discovery: OidcDiscovery;
  clientId: string;
  redirectUri: string;
  state: string;
  nonce: string;
  codeChallenge: string;
}

/** 認可エンドポイントへのリダイレクト先 URL を組み立てる(response_type=code・scope=openid email profile)。 */
export function buildAuthorizationUrl(params: AuthorizationUrlParams): string {
  const url = new URL(params.discovery.authorizationEndpoint);
  const query = url.searchParams;
  query.set("response_type", "code");
  query.set("client_id", params.clientId);
  query.set("redirect_uri", params.redirectUri);
  // profile は表示名の参考に取るだけで、KIZAMI 側のプロフィールは上書きしない
  // (自動プロビジョニングを行わないため、IdP の値が users を書き換えることはない)。
  query.set("scope", "openid email profile");
  query.set("state", params.state);
  query.set("nonce", params.nonce);
  query.set("code_challenge", params.codeChallenge);
  query.set("code_challenge_method", "S256");
  return url.toString();
}

// ---- トークン交換 ----------------------------------------------------------

export interface ExchangeCodeParams {
  discovery: OidcDiscovery;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  code: string;
  codeVerifier: string;
}

/**
 * 認可コードを ID トークンへ交換する。
 *
 * クライアント認証は既定で `client_secret_post`。ディスカバリ文書が対応方式を明示していて
 * post を含まず basic を含む場合のみ `client_secret_basic`(Authorization ヘッダ)に切り替える。
 */
export async function exchangeCode(params: ExchangeCodeParams, deps?: OidcNetworkDeps): Promise<string> {
  const { fetchImpl } = resolveDeps(deps);

  const methods = params.discovery.tokenEndpointAuthMethods;
  const useBasic = methods !== null && !methods.includes("client_secret_post") && methods.includes("client_secret_basic");

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: params.code,
    redirect_uri: params.redirectUri,
    client_id: params.clientId,
    code_verifier: params.codeVerifier,
  });
  const headers: Record<string, string> = {
    "content-type": "application/x-www-form-urlencoded",
    accept: "application/json",
  };
  if (useBasic) {
    // RFC 6749 §2.3.1: client_id / client_secret は form-urlencoded してから base64
    const credentials = `${encodeURIComponent(params.clientId)}:${encodeURIComponent(params.clientSecret)}`;
    headers.authorization = `Basic ${btoa(credentials)}`;
  } else {
    body.set("client_secret", params.clientSecret);
  }

  let res: Response;
  try {
    res = await fetchImpl(params.discovery.tokenEndpoint, { method: "POST", headers, body: body.toString() });
  } catch (cause) {
    throw new OidcError("sso_token_failed", `token request failed: ${String(cause)}`);
  }
  if (!res.ok) {
    // IdP のエラー本文はサーバーログにのみ残す(利用者には汎用コードしか返さない)。
    const text = await res.text().catch(() => "");
    throw new OidcError("sso_token_failed", `token endpoint returned ${res.status}: ${text.slice(0, 500)}`);
  }

  let payload: Record<string, unknown>;
  try {
    payload = (await res.json()) as Record<string, unknown>;
  } catch {
    throw new OidcError("sso_token_failed", "token endpoint returned non-JSON");
  }
  const idToken = payload.id_token;
  if (typeof idToken !== "string" || idToken === "") {
    throw new OidcError("sso_token_failed", "token response has no id_token");
  }
  return idToken;
}

// ---- ID トークン検証 -------------------------------------------------------

export interface VerifyIdTokenParams {
  discovery: OidcDiscovery;
  idToken: string;
  clientId: string;
  /** start で発行し Cookie に保存しておいた nonce。ID トークンの nonce と一致すること。 */
  expectedNonce: string;
}

export interface VerifiedIdentity {
  /** IdP が主張するメールアドレス(小文字化はしない — 突合側で扱いを決める)。 */
  email: string;
  emailVerified: boolean;
  subject: string;
}

/**
 * ID トークンを検証する。署名(JWKS)・iss・aud・exp/iat(60秒のクロックずれ許容)は
 * jose に任せ、nonce・azp・email 系はここで確認する。
 *
 * kid が JWKS に無い場合(鍵ローテーション直後)だけ JWKS を1回強制再取得して再試行する。
 */
export async function verifyIdToken(params: VerifyIdTokenParams, deps?: OidcNetworkDeps): Promise<VerifiedIdentity> {
  const attempt = async (force: boolean): Promise<JWTPayload> => {
    const jwks = await fetchJwks(params.discovery.jwksUri, deps, force);
    const keyStore = createLocalJWKSet(jwks);
    const { payload } = await jwtVerify(params.idToken, keyStore, {
      issuer: params.discovery.issuer,
      audience: params.clientId,
      clockTolerance: OIDC_CLOCK_TOLERANCE_SECONDS,
      algorithms: ALLOWED_ID_TOKEN_ALGS,
    });
    return payload;
  };

  let payload: JWTPayload;
  try {
    payload = await attempt(false);
  } catch (first) {
    // 署名鍵が見つからない場合のみ JWKS を取り直して1回だけ再試行する。
    // それ以外(iss/aud/exp 不一致・署名不正)は再取得しても結果が変わらない。
    const code = (first as { code?: unknown }).code;
    if (code !== "ERR_JWKS_NO_MATCHING_KEY") {
      throw new OidcError("sso_invalid_token", `id_token verification failed: ${String(first)}`);
    }
    try {
      payload = await attempt(true);
    } catch (second) {
      throw new OidcError("sso_invalid_token", `id_token verification failed after jwks refresh: ${String(second)}`);
    }
  }

  // nonce: start で発行した値と一致すること(ID トークンのリプレイ対策)。
  if (typeof payload.nonce !== "string" || !timingSafeEqual(payload.nonce, params.expectedNonce)) {
    throw new OidcError("sso_invalid_token", "id_token nonce mismatch");
  }

  // aud が複数ある場合、OIDC Core §3.1.3.7 は azp の確認を要求する。
  if (Array.isArray(payload.aud) && payload.aud.length > 1) {
    if (payload.azp !== params.clientId) {
      throw new OidcError("sso_invalid_token", "id_token azp does not match client_id");
    }
  }

  const subject = typeof payload.sub === "string" ? payload.sub : "";
  if (subject === "") {
    throw new OidcError("sso_invalid_token", "id_token has no sub");
  }

  const email = payload.email;
  if (typeof email !== "string" || email.trim() === "") {
    // 突合の唯一の材料がメールアドレスなので、無ければログインは成立しない。
    throw new OidcError("sso_email_missing", "id_token has no email claim");
  }

  // email_verified は boolean が正しいが、文字列 "true" を返す IdP が実在するため両方受ける。
  const rawVerified = payload.email_verified;
  const emailVerified = rawVerified === true || rawVerified === "true";

  return { email: email.trim(), emailVerified, subject };
}
