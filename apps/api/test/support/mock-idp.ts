/**
 * テスト用の偽 IdP(OpenID Provider)。**実 IdP には一切接続しない**(要件: テストは実 IdP に
 * 接続しない・通知も送らない)。
 *
 * 実体は `fetch` 互換の関数1つ。apps/api の OIDC 実装はネットワークアクセスをすべて
 * 注入された fetch 経由で行う(apps/api/src/lib/oidc.ts)ため、これを差し込むだけで
 * ディスカバリ・JWKS・トークンエンドポイントの3本を丸ごと差し替えられる。
 *
 * 鍵は毎回その場で RSA(RS256)を生成し、公開鍵を JWKS として配る。ID トークンは
 * `jose` の SignJWT で署名するため、検証側(本番と同じ verifyIdToken)を素通りさせるための
 * 細工は一切していない — 失敗系のテストは「わざと壊した ID トークンを出す」形で作る。
 */

import { exportJWK, generateKeyPair, SignJWT, type CryptoKey, type JWK } from "jose";

export interface MockIdpOptions {
  issuer: string;
  clientId: string;
  clientSecret: string;
  /** ID トークンに載せる email。 */
  email: string;
  /** ID トークンに載せる email_verified(既定 true)。 */
  emailVerified?: boolean;
}

export interface MockIdpOverrides {
  /** ID トークンの nonce を強制上書きする(nonce 不一致のテスト用)。 */
  nonce?: string;
  /** ID トークンの aud を強制上書きする(aud 不正のテスト用)。 */
  audience?: string;
  /** ID トークンの iss を強制上書きする。 */
  tokenIssuer?: string;
  /** 現在時刻からの相対秒。負値にすると期限切れトークンになる(既定 +300)。 */
  expiresInSeconds?: number;
  /** token エンドポイントを HTTP エラーにする。 */
  tokenEndpointStatus?: number;
  /** ディスカバリ文書の issuer を実際の issuer と食い違わせる。 */
  discoveryIssuer?: string;
}

export interface MockIdp {
  fetchImpl: typeof fetch;
  /** 認可エンドポイントへ渡されたクエリ(start が組み立てた URL をテストが解析して渡す)。 */
  setAuthorizationRequest(params: { nonce: string; codeChallenge: string }): void;
  /** token エンドポイントが受け取ったフォームパラメータ(PKCE の検証用)。 */
  tokenRequests: URLSearchParams[];
  /** token エンドポイントが受け取った Authorization ヘッダ(client_secret_basic の確認用)。 */
  tokenAuthHeaders: (string | null)[];
  overrides: MockIdpOverrides;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

export async function createMockIdp(options: MockIdpOptions): Promise<MockIdp> {
  const { publicKey, privateKey } = (await generateKeyPair("RS256", { extractable: true })) as {
    publicKey: CryptoKey;
    privateKey: CryptoKey;
  };
  const kid = "test-key-1";
  const publicJwk: JWK = { ...(await exportJWK(publicKey)), kid, alg: "RS256", use: "sig" };

  const issuer = options.issuer.replace(/\/+$/, "");
  const state: { nonce: string; codeChallenge: string } = { nonce: "", codeChallenge: "" };
  const idp: MockIdp = {
    fetchImpl: null as unknown as typeof fetch,
    setAuthorizationRequest(params) {
      state.nonce = params.nonce;
      state.codeChallenge = params.codeChallenge;
    },
    tokenRequests: [],
    tokenAuthHeaders: [],
    overrides: {},
  };

  async function issueIdToken(): Promise<string> {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const expiresIn = idp.overrides.expiresInSeconds ?? 300;
    return new SignJWT({
      nonce: idp.overrides.nonce ?? state.nonce,
      email: options.email,
      email_verified: options.emailVerified ?? true,
      name: "IdP User",
    })
      .setProtectedHeader({ alg: "RS256", kid })
      .setIssuer(idp.overrides.tokenIssuer ?? issuer)
      .setAudience(idp.overrides.audience ?? options.clientId)
      .setSubject("idp-subject-1")
      .setIssuedAt(nowSeconds)
      .setExpirationTime(nowSeconds + expiresIn)
      .sign(privateKey);
  }

  idp.fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

    if (url === `${issuer}/.well-known/openid-configuration`) {
      return json({
        issuer: idp.overrides.discoveryIssuer ?? issuer,
        authorization_endpoint: `${issuer}/authorize`,
        token_endpoint: `${issuer}/token`,
        jwks_uri: `${issuer}/jwks`,
        response_types_supported: ["code"],
        subject_types_supported: ["public"],
        id_token_signing_alg_values_supported: ["RS256"],
        token_endpoint_auth_methods_supported: ["client_secret_post", "client_secret_basic"],
        code_challenge_methods_supported: ["S256"],
      });
    }

    if (url === `${issuer}/jwks`) {
      return json({ keys: [publicJwk] });
    }

    if (url === `${issuer}/token`) {
      const params = new URLSearchParams(typeof init?.body === "string" ? init.body : "");
      idp.tokenRequests.push(params);
      const headers = init?.headers as Record<string, string> | undefined;
      idp.tokenAuthHeaders.push(headers?.authorization ?? null);

      if (idp.overrides.tokenEndpointStatus !== undefined) {
        return json({ error: "invalid_grant" }, idp.overrides.tokenEndpointStatus);
      }
      // client_secret_post を既定にしているので、シークレット不一致はここで弾く
      // (実 IdP と同じく 401 を返す)。
      if (params.get("client_secret") !== options.clientSecret) {
        return json({ error: "invalid_client" }, 401);
      }
      return json({
        access_token: "mock-access-token",
        token_type: "Bearer",
        expires_in: 3600,
        id_token: await issueIdToken(),
      });
    }

    throw new Error(`mock idp: unexpected fetch to ${url}`);
  }) as typeof fetch;

  return idp;
}
