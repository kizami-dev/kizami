/**
 * OIDC(SSO)ログインのテスト: POST /auth/oidc/start, GET /auth/oidc/callback,
 * GET /auth/oidc/available。docs/design/sso-oidc.md が仕様の正。
 *
 * IdP はテスト内の偽実装(test/support/mock-idp.ts、RSA 鍵をその場で生成して JWKS を配る)を
 * 注入 fetch 経由で使う — **実 IdP には接続しない**。
 */

import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { auditLogs, tenants, upsertTenantOidcSettings, users, uuidv7, type Database } from "@kizami/db";
import { createApp } from "../src/app.js";
import { clearOidcCaches } from "../src/lib/oidc.js";
import { createMockIdp, type MockIdp } from "./support/mock-idp.js";
import { setupTestDb, testEncryptor } from "./support/setup.js";

const CLIENT_ID = "kizami-test-client";
const CLIENT_SECRET = "kizami-test-client-secret";

/** issuer はテストごとに変える(lib/oidc.ts のディスカバリ/JWKS キャッシュはプロセス内共有のため)。 */
let issuerCounter = 0;
function nextIssuer(): string {
  issuerCounter += 1;
  return `https://idp-${issuerCounter}.example.test`;
}

interface RequestLike {
  request: (path: string, init?: RequestInit) => Promise<Response> | Response;
}

async function configureSso(
  db: Database,
  params: { tenantId: string; userId: string; issuer: string; enabled?: boolean; allowUnverifiedEmail?: boolean },
): Promise<void> {
  await upsertTenantOidcSettings(db, {
    tenantId: params.tenantId,
    issuer: params.issuer,
    clientId: CLIENT_ID,
    clientSecret: await testEncryptor().encrypt(CLIENT_SECRET),
    enabled: params.enabled ?? true,
    allowUnverifiedEmail: params.allowUnverifiedEmail ?? false,
    updatedAt: 0,
    updatedBy: params.userId,
  });
}

function cookieNamed(res: Response, name: string): string | null {
  const raw = res.headers.getSetCookie();
  for (const line of raw) {
    if (line.startsWith(`${name}=`)) {
      const pair = line.split(";")[0] as string;
      // 値が空 = 削除指示。呼び出し側が「消えたこと」を確認できるようそのまま返す。
      return pair;
    }
  }
  return null;
}

/** start → 認可URLの解析 → 偽 IdP へ nonce/PKCE を教える、までをまとめて行う。 */
async function startSso(
  app: RequestLike,
  idp: MockIdp,
  tenantId: string,
): Promise<{ txCookie: string; state: string; authorizeUrl: URL }> {
  const res = await app.request("/auth/oidc/start", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ tenantId }),
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { redirectUrl: string };
  const authorizeUrl = new URL(body.redirectUrl);
  const nonce = authorizeUrl.searchParams.get("nonce") ?? "";
  const codeChallenge = authorizeUrl.searchParams.get("code_challenge") ?? "";
  idp.setAuthorizationRequest({ nonce, codeChallenge });

  const txCookie = cookieNamed(res, "kizami_oidc_tx");
  expect(txCookie).not.toBeNull();
  return { txCookie: txCookie as string, state: authorizeUrl.searchParams.get("state") ?? "", authorizeUrl };
}

function callback(app: RequestLike, params: { code: string; state: string; cookie?: string }): Promise<Response> {
  const query = new URLSearchParams({ code: params.code, state: params.state });
  return Promise.resolve(
    app.request(`/auth/oidc/callback?${query.toString()}`, {
      headers: params.cookie ? { cookie: params.cookie } : {},
    }),
  );
}

function errorCodeFromRedirect(res: Response): string | null {
  expect(res.status).toBe(302);
  const location = res.headers.get("location") ?? "";
  const url = new URL(location, "http://localhost");
  expect(url.pathname).toBe("/login");
  return url.searchParams.get("error");
}

describe("OIDC SSO ログイン", () => {
  beforeEach(() => {
    clearOidcCaches();
  });

  async function scenario(overrides: { email?: string; emailVerified?: boolean; allowUnverifiedEmail?: boolean } = {}) {
    const seeded = await setupTestDb();
    const issuer = nextIssuer();
    const idp = await createMockIdp({
      issuer,
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      email: overrides.email ?? seeded.email,
      ...(overrides.emailVerified !== undefined ? { emailVerified: overrides.emailVerified } : {}),
    });
    await configureSso(seeded.db, {
      tenantId: seeded.tenantId,
      userId: seeded.userId,
      issuer,
      ...(overrides.allowUnverifiedEmail !== undefined ? { allowUnverifiedEmail: overrides.allowUnverifiedEmail } : {}),
    });
    const app = createApp({
      db: seeded.db,
      encryptor: testEncryptor(),
      oidc: { network: { fetchImpl: idp.fetchImpl } },
    });
    return { seeded, idp, app, issuer };
  }

  it("ハッピーパス: 既存ユーザーのメールが一致すればセッションが張られ、ホームへ戻る", async () => {
    const { seeded, idp, app } = await scenario();

    const { txCookie, state, authorizeUrl } = await startSso(app, idp, seeded.tenantId);

    // 認可リクエストは PKCE(S256)・state・nonce を必ず含む
    expect(authorizeUrl.searchParams.get("response_type")).toBe("code");
    expect(authorizeUrl.searchParams.get("client_id")).toBe(CLIENT_ID);
    expect(authorizeUrl.searchParams.get("code_challenge_method")).toBe("S256");
    expect(authorizeUrl.searchParams.get("code_challenge")).toBeTruthy();
    expect(authorizeUrl.searchParams.get("state")).toBeTruthy();
    expect(authorizeUrl.searchParams.get("nonce")).toBeTruthy();
    expect(authorizeUrl.searchParams.get("redirect_uri")).toBe("http://localhost/auth/oidc/callback");

    const res = await callback(app, { code: "auth-code-1", state, cookie: txCookie });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/");

    // トークン交換では code_verifier(PKCE)と redirect_uri が送られる
    const tokenRequest = idp.tokenRequests[0];
    expect(tokenRequest?.get("grant_type")).toBe("authorization_code");
    expect(tokenRequest?.get("code_verifier")).toBeTruthy();
    expect(tokenRequest?.get("redirect_uri")).toBe("http://localhost/auth/oidc/callback");

    // 発行されたセッション Cookie で認証済み API が通る
    const sessionCookie = cookieNamed(res, "kizami_session");
    expect(sessionCookie).not.toBeNull();
    const me = await app.request("/me", { headers: { cookie: sessionCookie as string } });
    expect(me.status).toBe(200);
    const meBody = (await me.json()) as { user: { email: string } };
    expect(meBody.user.email).toBe(seeded.email);

    // 一回きりの状態 Cookie は消される
    expect(cookieNamed(res, "kizami_oidc_tx")).toBe("kizami_oidc_tx=");

    // 監査ログ(method: "oidc")
    const logs = await seeded.db.select().from(auditLogs).where(eq(auditLogs.action, "auth.login"));
    expect(logs).toHaveLength(1);
    const detail = JSON.parse(logs[0]?.afterDigest ?? "{}") as { method: string; issuer: string };
    expect(detail.method).toBe("oidc");
  });

  it("IdP のメールが大文字小文字だけ違っても同一ユーザーとして突合する", async () => {
    const seeded = await setupTestDb();
    const issuer = nextIssuer();
    const idp = await createMockIdp({
      issuer,
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      email: seeded.email.toUpperCase(),
    });
    await configureSso(seeded.db, { tenantId: seeded.tenantId, userId: seeded.userId, issuer });
    const app = createApp({ db: seeded.db, encryptor: testEncryptor(), oidc: { network: { fetchImpl: idp.fetchImpl } } });

    const { txCookie, state } = await startSso(app, idp, seeded.tenantId);
    const res = await callback(app, { code: "auth-code-1", state, cookie: txCookie });
    expect(res.headers.get("location")).toBe("/");
  });

  it("テナントに該当メールのユーザーが居なければ拒否する(自動プロビジョニングはしない)", async () => {
    const { seeded, idp, app } = await scenario({ email: "not-invited@example.com" });

    const { txCookie, state } = await startSso(app, idp, seeded.tenantId);
    const res = await callback(app, { code: "auth-code-1", state, cookie: txCookie });
    expect(errorCodeFromRedirect(res)).toBe("sso_user_not_found");

    // users 行は増えていない(招待式のみ)
    const rows = await seeded.db
      .select()
      .from(users)
      .where(and(eq(users.tenantId, seeded.tenantId), eq(users.email, "not-invited@example.com")));
    expect(rows).toHaveLength(0);
  });

  it("無効化されたユーザーではログインできない", async () => {
    const { seeded, idp, app } = await scenario();
    await seeded.db.update(users).set({ isActive: false }).where(eq(users.id, seeded.userId));

    const { txCookie, state } = await startSso(app, idp, seeded.tenantId);
    const res = await callback(app, { code: "auth-code-1", state, cookie: txCookie });
    expect(errorCodeFromRedirect(res)).toBe("sso_user_not_found");
  });

  it("email_verified が false のトークンは既定で拒否する", async () => {
    const { seeded, idp, app } = await scenario({ emailVerified: false });

    const { txCookie, state } = await startSso(app, idp, seeded.tenantId);
    const res = await callback(app, { code: "auth-code-1", state, cookie: txCookie });
    expect(errorCodeFromRedirect(res)).toBe("sso_email_unverified");
  });

  it("allowUnverifiedEmail を有効にすると email_verified が false でも通る", async () => {
    const { seeded, idp, app } = await scenario({ emailVerified: false, allowUnverifiedEmail: true });

    const { txCookie, state } = await startSso(app, idp, seeded.tenantId);
    const res = await callback(app, { code: "auth-code-1", state, cookie: txCookie });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/");
  });

  it("state が一致しなければ拒否する", async () => {
    const { seeded, idp, app } = await scenario();

    const { txCookie } = await startSso(app, idp, seeded.tenantId);
    const res = await callback(app, { code: "auth-code-1", state: "tampered-state", cookie: txCookie });
    expect(errorCodeFromRedirect(res)).toBe("sso_state_mismatch");
  });

  it("状態 Cookie が無ければ拒否する(コールバックの単独リプレイ)", async () => {
    const { seeded, idp, app } = await scenario();

    const { state } = await startSso(app, idp, seeded.tenantId);
    const res = await callback(app, { code: "auth-code-1", state });
    expect(errorCodeFromRedirect(res)).toBe("sso_state_mismatch");
  });

  it("ID トークンの nonce が一致しなければ拒否する", async () => {
    const { seeded, idp, app } = await scenario();

    const { txCookie, state } = await startSso(app, idp, seeded.tenantId);
    idp.overrides.nonce = "some-other-nonce";
    const res = await callback(app, { code: "auth-code-1", state, cookie: txCookie });
    expect(errorCodeFromRedirect(res)).toBe("sso_invalid_token");
  });

  it("ID トークンの aud が client_id と違えば拒否する", async () => {
    const { seeded, idp, app } = await scenario();

    const { txCookie, state } = await startSso(app, idp, seeded.tenantId);
    idp.overrides.audience = "someone-elses-client-id";
    const res = await callback(app, { code: "auth-code-1", state, cookie: txCookie });
    expect(errorCodeFromRedirect(res)).toBe("sso_invalid_token");
  });

  it("ID トークンの iss が issuer と違えば拒否する", async () => {
    const { seeded, idp, app } = await scenario();

    const { txCookie, state } = await startSso(app, idp, seeded.tenantId);
    idp.overrides.tokenIssuer = "https://evil.example.test";
    const res = await callback(app, { code: "auth-code-1", state, cookie: txCookie });
    expect(errorCodeFromRedirect(res)).toBe("sso_invalid_token");
  });

  it("期限切れの ID トークンは拒否する(許容するずれは60秒まで)", async () => {
    const { seeded, idp, app } = await scenario();

    const { txCookie, state } = await startSso(app, idp, seeded.tenantId);
    idp.overrides.expiresInSeconds = -120;
    const res = await callback(app, { code: "auth-code-1", state, cookie: txCookie });
    expect(errorCodeFromRedirect(res)).toBe("sso_invalid_token");
  });

  it("トークンエンドポイントが失敗したら sso_token_failed で戻す", async () => {
    const { seeded, idp, app } = await scenario();

    const { txCookie, state } = await startSso(app, idp, seeded.tenantId);
    idp.overrides.tokenEndpointStatus = 400;
    const res = await callback(app, { code: "auth-code-1", state, cookie: txCookie });
    expect(errorCodeFromRedirect(res)).toBe("sso_token_failed");
  });

  it("SSO が無効なテナントでは start が 400 sso_not_enabled を返す", async () => {
    const seeded = await setupTestDb();
    const issuer = nextIssuer();
    const idp = await createMockIdp({ issuer, clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, email: seeded.email });
    await configureSso(seeded.db, { tenantId: seeded.tenantId, userId: seeded.userId, issuer, enabled: false });
    const app = createApp({ db: seeded.db, encryptor: testEncryptor(), oidc: { network: { fetchImpl: idp.fetchImpl } } });

    const res = await app.request("/auth/oidc/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tenantId: seeded.tenantId }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "sso_not_enabled" });
  });

  it("暗号鍵が無い環境では start が 503 encryption_unavailable を返す(平文フォールバックはしない)", async () => {
    const seeded = await setupTestDb();
    const issuer = nextIssuer();
    const idp = await createMockIdp({ issuer, clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, email: seeded.email });
    await configureSso(seeded.db, { tenantId: seeded.tenantId, userId: seeded.userId, issuer });
    const app = createApp({ db: seeded.db, encryptor: null, oidc: { network: { fetchImpl: idp.fetchImpl } } });

    const res = await app.request("/auth/oidc/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tenantId: seeded.tenantId }),
    });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "encryption_unavailable" });
  });

  it("ディスカバリ文書の issuer が設定と食い違えば start を拒否する", async () => {
    const { seeded, idp, app } = await scenario();
    idp.overrides.discoveryIssuer = "https://evil.example.test";

    const res = await app.request("/auth/oidc/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tenantId: seeded.tenantId }),
    });
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "sso_discovery_failed" });
  });

  describe("GET /auth/oidc/available", () => {
    it("SSO が有効なテナントに在籍していればそのテナントを返す", async () => {
      const { seeded, app } = await scenario();
      const res = await app.request(`/auth/oidc/available?email=${encodeURIComponent(seeded.email)}`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { tenants: { id: string; name: string | null; ssoEnabled: boolean }[] };
      expect(body.tenants).toEqual([{ id: seeded.tenantId, name: "Test Tenant", ssoEnabled: true }]);
    });

    it("SSO が無効なテナントは一切載せない(在籍の有無を漏らさない)", async () => {
      const seeded = await setupTestDb();
      const issuer = nextIssuer();
      const idp = await createMockIdp({ issuer, clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, email: seeded.email });
      await configureSso(seeded.db, { tenantId: seeded.tenantId, userId: seeded.userId, issuer, enabled: false });
      const app = createApp({ db: seeded.db, encryptor: testEncryptor(), oidc: { network: { fetchImpl: idp.fetchImpl } } });

      const res = await app.request(`/auth/oidc/available?email=${encodeURIComponent(seeded.email)}`);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ tenants: [] });
    });

    it("存在しないメールアドレスでも 200 と空配列を返す(該当なしと同じ応答)", async () => {
      const { app } = await scenario();
      const res = await app.request(`/auth/oidc/available?email=${encodeURIComponent("nobody@example.com")}`);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ tenants: [] });
    });

    it("email が無ければ 400", async () => {
      const { app } = await scenario();
      const res = await app.request("/auth/oidc/available");
      expect(res.status).toBe(400);
    });
  });

  it("別テナントに同じメールのユーザーが居ても、start で指定したテナントのユーザーが選ばれる", async () => {
    const { seeded, idp, app } = await scenario();

    // 同一メールの複数テナント登録は要件 §7 で許容されている(顧問社労士等)。
    const otherTenantId = uuidv7();
    await seeded.db.insert(tenants).values({ id: otherTenantId, name: "Other Tenant", createdAt: 0 });
    await seeded.db.insert(users).values({
      id: uuidv7(),
      tenantId: otherTenantId,
      email: seeded.email,
      name: "Other Tenant User",
      isActive: true,
      createdAt: 0,
    });

    const { txCookie, state } = await startSso(app, idp, seeded.tenantId);
    const res = await callback(app, { code: "auth-code-1", state, cookie: txCookie });
    expect(res.headers.get("location")).toBe("/");

    const sessionCookie = cookieNamed(res, "kizami_session");
    const me = await app.request("/me", { headers: { cookie: sessionCookie as string } });
    const meBody = (await me.json()) as { user: { id: string } };
    expect(meBody.user.id).toBe(seeded.userId);
  });

  it("同一テナント内に大文字小文字だけ違う2アカウントがあれば、推測せず拒否する", async () => {
    const { seeded, idp, app } = await scenario();
    await seeded.db.insert(users).values({
      id: uuidv7(),
      tenantId: seeded.tenantId,
      email: seeded.email.toUpperCase(),
      name: "Shouty Duplicate",
      isActive: true,
      createdAt: 0,
    });

    const { txCookie, state } = await startSso(app, idp, seeded.tenantId);
    const res = await callback(app, { code: "auth-code-1", state, cookie: txCookie });
    expect(errorCodeFromRedirect(res)).toBe("sso_user_not_found");
  });
});
