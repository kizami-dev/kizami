/**
 * ブラウザプッシュ通知(Web Push)チャネル。
 *
 * 判断点(2026-08-24、完了報告に明記): **外部サービスも npm の `web-push` パッケージも使わず、
 * WebCrypto(`crypto.subtle`)だけで Web Push プロトコルを実装する**。
 *
 * - `web-push` は `node:crypto` に依存しており、@kizami/notify の大原則
 *   「ランタイム非依存(node:* を使わない・fetch と設定注入だけに依存する)」を破る。
 *   将来 Cloudflare Workers から日次スキャンを回す構想(apps/api/src/worker.ts 冒頭)が
 *   ある以上、ここで Node 専用の依存を持ち込むと通知チャネルだけが移植できなくなる。
 * - 必要な素材(ECDH P-256 / HKDF-SHA256 / AES-128-GCM / ECDSA P-256 署名)は
 *   すべて WebCrypto の標準機能で揃う。実装量は 200 行程度で、依存を1つ増やすより安い。
 *   同じ判断で packages/crypto(AES-256-GCM)も node:crypto を使っていない。
 *
 * 実装している規格:
 * - RFC 8291 Message Encryption for Web Push(`aes128gcm`。RFC 8188 の暗号化 Content-Encoding)
 * - RFC 8292 VAPID(`Authorization: vapid t=<JWT>, k=<公開鍵>`)
 *
 * 鍵の受け渡し形式(すべて base64url、パディング無し。`npx web-push generate-vapid-keys` や
 * scripts/generate-vapid.mjs が出す形式と同じ):
 * - VAPID 公開鍵: 非圧縮 EC 点 65 バイト(0x04 || X(32) || Y(32))
 * - VAPID 秘密鍵: スカラー 32 バイト
 * - 購読側の p256dh: 非圧縮 EC 点 65 バイト / auth: 16 バイト
 *
 * 失敗の扱い(呼び出し側との契約):
 * - 404 / 410 は「購読がもう存在しない」= 恒久的失敗。`WebPushGoneError` を投げる。
 *   呼び出し側(apps/api/src/lib/notification-channels.ts)はこれを捕まえて
 *   push_subscriptions.failed_at を立て、以後その購読をスキップする。
 * - それ以外の非 2xx・ネットワークエラーは一時的失敗として通常の Error を投げる
 *   (dispatch() が allSettled で拾い、他チャネルの送信は止まらない)。
 */

import type { NotificationChannel, NotificationMessage } from "./types.js";

/** ブラウザの PushSubscription(`subscription.toJSON()` 相当)。 */
export interface WebPushSubscription {
  endpoint: string;
  /** 購読者の公開鍵(非圧縮 EC 点 65 バイト、base64url) */
  p256dh: string;
  /** 認証シークレット(16 バイト、base64url) */
  auth: string;
}

/** VAPID 鍵ペアと連絡先(環境変数 VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT)。 */
export interface VapidKeys {
  publicKey: string;
  privateKey: string;
  /** RFC 8292 の `sub`。`mailto:` または `https:` の URL */
  subject: string;
}

export interface WebPushChannelOptions {
  /** fetch の差し替え(テスト用)。省略時はグローバル fetch */
  fetchImpl?: typeof fetch;
  /** 通知クリック時に開く URL(サービスワーカーが使う)。省略時は "/" */
  defaultUrl?: string;
  /** プッシュサービスに保持を依頼する秒数(既定 24 時間)。 */
  ttlSeconds?: number;
  /** VAPID JWT の有効期限を決めるための現在時刻(ミリ秒)。テストで固定するための注入点 */
  now?: () => number;
}

/**
 * プッシュサービスが 404 / 410 を返した(= 購読が失効した)ことを表す。
 * 呼び出し側はこれを見て購読行に failed_at を立てる(遅延プルーニング)。
 */
export class WebPushGoneError extends Error {
  readonly endpoint: string;
  readonly status: number;

  constructor(endpoint: string, status: number) {
    super(`webPushChannel: subscription is gone (${status}) for ${endpoint}`);
    this.name = "WebPushGoneError";
    this.endpoint = endpoint;
    this.status = status;
  }
}

const DEFAULT_TTL_SECONDS = 24 * 60 * 60;
/** RFC 8188 の record size。1レコードに収める(KIZAMI の本文は数百バイト)。 */
const RECORD_SIZE = 4096;
/** VAPID JWT の有効期限。RFC 8292 は 24 時間以内を要求するので余裕を持って 12 時間。 */
const JWT_LIFETIME_SECONDS = 12 * 60 * 60;

// ---------------------------------------------------------------------------
// base64url / バイト列ユーティリティ
// ---------------------------------------------------------------------------

export function base64UrlDecode(value: string): Uint8Array {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

const textEncoder = new TextEncoder();

/** `"WebPush: info\0"` のような、末尾に NUL を持つ HKDF info 文字列を作る。 */
function infoBytes(label: string, ...suffix: Uint8Array[]): Uint8Array {
  return concatBytes(textEncoder.encode(label), new Uint8Array([0]), ...suffix);
}

// ---------------------------------------------------------------------------
// VAPID(RFC 8292)
// ---------------------------------------------------------------------------

/**
 * 生の EC 鍵(公開: 非圧縮点 65B / 秘密: スカラー 32B)を JWK へ組み立てる。
 * WebCrypto は "raw" 形式での**秘密鍵**インポートに対応しないため、JWK 経由にする必要がある。
 */
function toEcJwk(publicKey: Uint8Array, privateKey: Uint8Array | null): JsonWebKey {
  if (publicKey.length !== 65 || publicKey[0] !== 0x04) {
    throw new Error("web-push: VAPID public key must be a 65-byte uncompressed EC point");
  }
  const jwk: JsonWebKey = {
    kty: "EC",
    crv: "P-256",
    x: base64UrlEncode(publicKey.subarray(1, 33)),
    y: base64UrlEncode(publicKey.subarray(33, 65)),
    ext: true,
  };
  if (privateKey) {
    if (privateKey.length !== 32) {
      throw new Error("web-push: VAPID private key must decode to 32 bytes");
    }
    jwk.d = base64UrlEncode(privateKey);
  }
  return jwk;
}

/** エンドポイント URL の origin(VAPID JWT の `aud`)。 */
function audienceOf(endpoint: string): string {
  return new URL(endpoint).origin;
}

/**
 * `Authorization: vapid t=<JWT>, k=<公開鍵>` ヘッダの値を組み立てる。
 * 同じ VAPID 鍵・同じ audience でも JWT は毎回作り直す(exp が入るため使い回しはしない)。
 */
export async function buildVapidAuthorization(vapid: VapidKeys, endpoint: string, nowMs: number): Promise<string> {
  const publicKeyBytes = base64UrlDecode(vapid.publicKey);
  const privateKeyBytes = base64UrlDecode(vapid.privateKey);

  const key = await crypto.subtle.importKey(
    "jwk",
    toEcJwk(publicKeyBytes, privateKeyBytes),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );

  const header = base64UrlEncode(textEncoder.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const payload = base64UrlEncode(
    textEncoder.encode(
      JSON.stringify({
        aud: audienceOf(endpoint),
        exp: Math.floor(nowMs / 1000) + JWT_LIFETIME_SECONDS,
        sub: vapid.subject,
      }),
    ),
  );
  const signingInput = textEncoder.encode(`${header}.${payload}`);
  // ECDSA の WebCrypto 出力は既に r||s の 64 バイト(JWS が要求する形式)。DER 変換は不要。
  const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, signingInput as BufferSource);

  const jwt = `${header}.${payload}.${base64UrlEncode(new Uint8Array(signature))}`;
  return `vapid t=${jwt}, k=${vapid.publicKey}`;
}

// ---------------------------------------------------------------------------
// 本文の暗号化(RFC 8291 / aes128gcm)
// ---------------------------------------------------------------------------

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, lengthBytes: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", ikm as BufferSource, "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: salt as BufferSource, info: info as BufferSource },
    key,
    lengthBytes * 8,
  );
  return new Uint8Array(bits);
}

/**
 * RFC 8291 の本文暗号化。戻り値はそのまま HTTP ボディ(`Content-Encoding: aes128gcm`)になる:
 *
 *   salt(16) || rs(4, BE) || idlen(1)=65 || 送信側の一時公開鍵(65) || 暗号文
 */
export async function encryptWebPushPayload(
  subscription: Pick<WebPushSubscription, "p256dh" | "auth">,
  plaintext: Uint8Array,
  /** salt と一時鍵を固定してテストから決定的に検証するための注入点(通常は省略) */
  overrides?: { salt?: Uint8Array; ephemeralKeyPair?: CryptoKeyPair },
): Promise<Uint8Array> {
  const uaPublicBytes = base64UrlDecode(subscription.p256dh);
  const authSecret = base64UrlDecode(subscription.auth);

  const uaPublicKey = await crypto.subtle.importKey(
    "raw",
    uaPublicBytes as BufferSource,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );

  const ephemeral =
    overrides?.ephemeralKeyPair ??
    ((await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair);
  const asPublicBytes = new Uint8Array(await crypto.subtle.exportKey("raw", ephemeral.publicKey));

  const sharedSecret = new Uint8Array(
    await crypto.subtle.deriveBits({ name: "ECDH", public: uaPublicKey }, ephemeral.privateKey, 256),
  );

  const salt = overrides?.salt ?? crypto.getRandomValues(new Uint8Array(16));

  // IKM = HKDF(salt=auth_secret, ikm=ECDH共有秘密, info="WebPush: info\0"||ua_public||as_public)
  const ikm = await hkdf(authSecret, sharedSecret, infoBytes("WebPush: info", uaPublicBytes, asPublicBytes), 32);
  const cek = await hkdf(salt, ikm, infoBytes("Content-Encoding: aes128gcm"), 16);
  const nonce = await hkdf(salt, ikm, infoBytes("Content-Encoding: nonce"), 12);

  const aesKey = await crypto.subtle.importKey("raw", cek as BufferSource, "AES-GCM", false, ["encrypt"]);
  // 1レコードで送り切るので、パディング区切りは「最終レコード」を表す 0x02。
  const padded = concatBytes(plaintext, new Uint8Array([0x02]));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce as BufferSource }, aesKey, padded as BufferSource),
  );

  const recordSize = new Uint8Array(4);
  new DataView(recordSize.buffer).setUint32(0, RECORD_SIZE, false);

  return concatBytes(salt, recordSize, new Uint8Array([asPublicBytes.length]), asPublicBytes, ciphertext);
}

// ---------------------------------------------------------------------------
// チャネル
// ---------------------------------------------------------------------------

/**
 * 1つの購読(= 1ブラウザ)へ送る NotificationChannel を作る。
 *
 * ペイロードは `{"title","body","url"}` の JSON。サービスワーカー(apps/web/public/sw.js)の
 * push ハンドラがこの3つだけを読む契約にしてある(項目を増やすときは sw.js と同時に直すこと)。
 */
export function webPushChannel(
  subscription: WebPushSubscription,
  vapid: VapidKeys,
  options: WebPushChannelOptions = {},
): NotificationChannel {
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? (() => Date.now());
  const ttl = options.ttlSeconds ?? DEFAULT_TTL_SECONDS;

  return {
    name: "web_push",
    async send(msg: NotificationMessage): Promise<void> {
      const payload = textEncoder.encode(
        JSON.stringify({ title: msg.title, body: msg.body, url: msg.url ?? options.defaultUrl ?? "/" }),
      );
      const body = await encryptWebPushPayload(subscription, payload);
      const authorization = await buildVapidAuthorization(vapid, subscription.endpoint, now());

      const res = await fetchImpl(subscription.endpoint, {
        method: "POST",
        headers: {
          authorization: authorization,
          "content-encoding": "aes128gcm",
          "content-type": "application/octet-stream",
          ttl: String(ttl),
          // 端末が省電力状態でも即時配送してほしい(打刻忘れ・承認依頼はいずれも即時性が要る)。
          urgency: "normal",
        },
        body: body as BodyInit,
      });

      if (res.status === 404 || res.status === 410) {
        throw new WebPushGoneError(subscription.endpoint, res.status);
      }
      if (!res.ok) {
        throw new Error(`webPushChannel: POST ${subscription.endpoint} responded ${res.status}`);
      }
    },
  };
}
