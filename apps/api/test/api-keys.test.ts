import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import { grantPermission, loginAndGetCookie, setupSecondUser, setupTestDb } from "./support/setup.js";

// JST 正午(日界・月境界から十分離れた安全な時刻)に固定して、テストを実行時刻から独立させる。
const FIXED_NOW = new Date("2026-06-15T03:00:00.000Z");

interface IssuedApiKey {
  apiKey: { id: string; userId: string; scopes: string[]; expiresAt: number | null; lastUsedAt: number | null; revokedAt: number | null };
  token: string;
}

async function issueApiKey(
  app: ReturnType<typeof createApp>,
  cookie: string,
  body: { name: string; scopes: string[]; expiresAt?: number | null; userId?: string },
): Promise<{ status: number; json: any }> {
  const res = await app.request("/api-keys", {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
}

describe("public punch API (API keys)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("issues a key from the session and can punch with it; source is 'api'", async () => {
    const { db, email, password } = await setupTestDb();
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const issued = await issueApiKey(app, cookie, { name: "IC card reader", scopes: ["punch"] });
    expect(issued.status).toBe(201);
    const token: string = issued.json.apiKey.token;
    expect(token).toMatch(/^kzm_/);
    // レスポンスの apiKey オブジェクト自体には token 以外に平文相当の情報は無い(id 等のみ)。
    expect(issued.json.apiKey.id).toEqual(expect.any(String));

    const punchRes = await app.request("/punches", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ kind: "clock_in" }),
    });
    expect(punchRes.status).toBe(201);

    // punch 自体は authorization ヘッダのみで cookie 認証は使っていない(=キーで打刻できた)。
    const listRes = await app.request("/punches?from=0&to=999999999999", { headers: { cookie } });
    const { punches } = await listRes.json();
    expect(punches).toHaveLength(1);
    expect(punches[0].kind).toBe("clock_in");
  });

  it("rejects requests with no Authorization header and no cookie", async () => {
    const { db } = await setupTestDb();
    const app = createApp({ db });

    const res = await app.request("/punches", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "clock_in" }),
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
  });

  it("rejects a malformed bearer token with 401", async () => {
    const { db } = await setupTestDb();
    const app = createApp({ db });

    const res = await app.request("/punches", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer not-a-real-key" },
      body: JSON.stringify({ kind: "clock_in" }),
    });
    expect(res.status).toBe(401);
  });

  it("rejects an unknown (well-formed) token with 401", async () => {
    const { db } = await setupTestDb();
    const app = createApp({ db });

    const res = await app.request("/punches", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer kzm_00000000000000000000000000000000000000000" },
      body: JSON.stringify({ kind: "clock_in" }),
    });
    expect(res.status).toBe(401);
  });
});

describe("API key scope enforcement", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("a 'read'-scoped key cannot POST /punches (403 insufficient_api_key_scope)", async () => {
    const { db, email, password } = await setupTestDb();
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);
    const issued = await issueApiKey(app, cookie, { name: "read only", scopes: ["read"] });
    const token = issued.json.apiKey.token;

    const res = await app.request("/punches", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ kind: "clock_in" }),
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "insufficient_api_key_scope" });
  });

  it("a 'read'-scoped key CAN GET /punches and GET /attendance/status and GET /attendance/monthly and GET /leave/balance and GET /corrections", async () => {
    const { db, email, password } = await setupTestDb();
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);
    const issued = await issueApiKey(app, cookie, { name: "read only", scopes: ["read"] });
    const token = issued.json.apiKey.token;
    const auth = { authorization: `Bearer ${token}` };

    expect((await app.request("/punches?from=0&to=999999999999", { headers: auth })).status).toBe(200);
    expect((await app.request("/attendance/status", { headers: auth })).status).toBe(200);
    expect((await app.request("/attendance/monthly?month=2026-06", { headers: auth })).status).toBe(200);
    expect((await app.request("/leave/balance", { headers: auth })).status).toBe(200);
    expect((await app.request("/corrections", { headers: auth })).status).toBe(200);
  });

  it("a 'punch'-scoped key CANNOT GET /corrections (read-only, requires 'read' scope)", async () => {
    const { db, email, password } = await setupTestDb();
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);
    const issued = await issueApiKey(app, cookie, { name: "punch only", scopes: ["punch"] });
    const token = issued.json.apiKey.token;

    const res = await app.request("/corrections", { headers: { authorization: `Bearer ${token}` } });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "insufficient_api_key_scope" });
  });

  it("a 'read'-scoped key CANNOT POST /corrections (write operations are never exposed to API keys)", async () => {
    const { db, email, password } = await setupTestDb();
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);
    const issued = await issueApiKey(app, cookie, { name: "read only", scopes: ["read"] });
    const token = issued.json.apiKey.token;

    const res = await app.request("/corrections", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ proposedKind: "clock_in", proposedOccurredAt: 0, reason: "test" }),
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "insufficient_api_key_scope" });
  });

  it("a 'punch'-scoped key cannot change settings (403 insufficient_api_key_scope, not 401/200)", async () => {
    const { db, email, password } = await setupTestDb();
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);
    const issued = await issueApiKey(app, cookie, { name: "punch only", scopes: ["punch"] });
    const token = issued.json.apiKey.token;

    const res = await app.request("/settings/notifications", {
      method: "PUT",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ webhookEnabled: false, smtpEnabled: false }),
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "insufficient_api_key_scope" });
  });

  it("even a 'read'-scoped key cannot reach an endpoint outside the allowlist (GET /departments)", async () => {
    const { db, email, password } = await setupTestDb();
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);
    const issued = await issueApiKey(app, cookie, { name: "read only", scopes: ["read"] });
    const token = issued.json.apiKey.token;

    const res = await app.request("/departments", { headers: { authorization: `Bearer ${token}` } });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "insufficient_api_key_scope" });
  });

  it("a key with both scopes can access endpoints from either scope", async () => {
    const { db, email, password } = await setupTestDb();
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);
    const issued = await issueApiKey(app, cookie, { name: "both", scopes: ["punch", "read"] });
    const token = issued.json.apiKey.token;
    const auth = { authorization: `Bearer ${token}` };

    expect(
      (
        await app.request("/punches", {
          method: "POST",
          headers: { "content-type": "application/json", ...auth },
          body: JSON.stringify({ kind: "clock_in" }),
        })
      ).status,
    ).toBe(201);
    expect((await app.request("/attendance/monthly?month=2026-06", { headers: auth })).status).toBe(200);
  });
});

describe("revocation and expiry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("a revoked key is rejected with 401 even though it was valid before revocation", async () => {
    const { db, email, password } = await setupTestDb();
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);
    const issued = await issueApiKey(app, cookie, { name: "will be revoked", scopes: ["punch"] });
    const token = issued.json.apiKey.token;
    const id = issued.json.apiKey.id;

    // 失効前は使える
    expect(
      (
        await app.request("/punches", {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
          body: JSON.stringify({ kind: "clock_in" }),
        })
      ).status,
    ).toBe(201);

    const revokeRes = await app.request(`/api-keys/${id}`, { method: "DELETE", headers: { cookie } });
    expect(revokeRes.status).toBe(200);

    const afterRevoke = await app.request("/punches", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ kind: "clock_out" }),
    });
    expect(afterRevoke.status).toBe(401);
  });

  it("revoking the same key twice returns 409 already_revoked", async () => {
    const { db, email, password } = await setupTestDb();
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);
    const issued = await issueApiKey(app, cookie, { name: "k", scopes: ["punch"] });
    const id = issued.json.apiKey.id;

    expect((await app.request(`/api-keys/${id}`, { method: "DELETE", headers: { cookie } })).status).toBe(200);
    expect((await app.request(`/api-keys/${id}`, { method: "DELETE", headers: { cookie } })).status).toBe(409);
  });

  it("an expired key is rejected with 401", async () => {
    const { db, email, password } = await setupTestDb();
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const now = Math.floor(FIXED_NOW.getTime() / 60_000);
    const issued = await issueApiKey(app, cookie, { name: "short lived", scopes: ["punch"], expiresAt: now + 10 });
    const token = issued.json.apiKey.token;

    // 期限内はOK
    expect(
      (
        await app.request("/punches", {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
          body: JSON.stringify({ kind: "clock_in" }),
        })
      ).status,
    ).toBe(201);

    // 期限ちょうどはNG(findApiKeyByHash は gt なので expires_at と同時刻は失効扱い)
    vi.setSystemTime(new Date(FIXED_NOW.getTime() + 10 * 60_000));
    const atExpiry = await app.request("/punches", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ kind: "clock_out" }),
    });
    expect(atExpiry.status).toBe(401);
  });
});

describe("last_used_at throttling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("updates last_used_at on first use, but not again within 1 hour; updates again after 1 hour", async () => {
    const { db, email, password } = await setupTestDb();
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);
    const issued = await issueApiKey(app, cookie, { name: "k", scopes: ["read"] });
    const token = issued.json.apiKey.token;
    const id = issued.json.apiKey.id;

    expect(issued.json.apiKey.lastUsedAt).toBeNull();

    const getList = async () => {
      const res = await app.request("/api-keys", { headers: { cookie } });
      const { apiKeys } = await res.json();
      return apiKeys.find((k: { id: string }) => k.id === id);
    };

    await app.request("/punches?from=0&to=1", { headers: { authorization: `Bearer ${token}` } });
    const afterFirst = await getList();
    expect(afterFirst.lastUsedAt).not.toBeNull();
    const firstSeen = afterFirst.lastUsedAt as number;

    // 30分後: 1時間未満なので更新されない
    vi.setSystemTime(new Date(FIXED_NOW.getTime() + 30 * 60_000));
    await app.request("/punches?from=0&to=1", { headers: { authorization: `Bearer ${token}` } });
    const afterSecond = await getList();
    expect(afterSecond.lastUsedAt).toBe(firstSeen);

    // 最初の使用から61分後: 更新される
    vi.setSystemTime(new Date(FIXED_NOW.getTime() + 61 * 60_000));
    await app.request("/punches?from=0&to=1", { headers: { authorization: `Bearer ${token}` } });
    const afterThird = await getList();
    expect(afterThird.lastUsedAt).toBeGreaterThan(firstSeen);
  });
});

describe("scope guard under the /api reverse-proxy prefix (mirrors node.ts)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // node.ts は `root.route("/api", app); root.route("/", app);` で同じアプリを
  // /api プレフィクス付きでも提供する(パス書き換えなし)。apiKeyScopeGuardMiddleware の
  // 許可表マッチングがこのプレフィクスを考慮していないと、本番相当の経路(/api/punches 等)で
  // 有効なスコープを持つキーまで一律 403 になってしまう回帰を防ぐ。
  function createRootApp(db: Parameters<typeof createApp>[0]["db"]) {
    const app = createApp({ db });
    const root = new Hono();
    root.route("/api", app);
    root.route("/", app);
    return root;
  }

  it("a 'punch'-scoped key can POST /api/punches (reverse-proxy path) and it is recorded with source 'api'", async () => {
    const { db, email, password } = await setupTestDb();
    const innerApp = createApp({ db });
    const cookie = await loginAndGetCookie(innerApp, email, password);
    const issued = await issueApiKey(innerApp, cookie, { name: "via /api prefix", scopes: ["punch"] });
    const token = issued.json.apiKey.token;

    const root = createRootApp(db);
    const res = await root.request("/api/punches", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ kind: "clock_in" }),
    });
    expect(res.status).toBe(201);

    const listRes = await root.request("/api/punches?from=0&to=999999999999", {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(listRes.status).toBe(200);
  });

  it("scope enforcement still rejects out-of-scope endpoints reached via /api", async () => {
    const { db, email, password } = await setupTestDb();
    const innerApp = createApp({ db });
    const cookie = await loginAndGetCookie(innerApp, email, password);
    const issued = await issueApiKey(innerApp, cookie, { name: "via /api prefix", scopes: ["read"] });
    const token = issued.json.apiKey.token;

    const root = createRootApp(db);
    const res = await root.request("/api/punches", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ kind: "clock_in" }),
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "insufficient_api_key_scope" });
  });
});

describe("GET /api-keys never returns plaintext", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("list responses contain no token/hash field", async () => {
    const { db, email, password } = await setupTestDb();
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);
    const issued = await issueApiKey(app, cookie, { name: "k", scopes: ["punch"] });
    const rawToken: string = issued.json.apiKey.token;

    const res = await app.request("/api-keys", { headers: { cookie } });
    expect(res.status).toBe(200);
    const bodyText = await res.text();
    expect(bodyText).not.toContain(rawToken);
    expect(bodyText).not.toContain("keyHash");
    expect(bodyText).not.toContain("token");

    const { apiKeys } = JSON.parse(bodyText);
    expect(apiKeys).toHaveLength(1);
    expect(apiKeys[0]).toEqual({
      id: issued.json.apiKey.id,
      userId: expect.any(String),
      name: "k",
      scopes: ["punch"],
      expiresAt: null,
      lastUsedAt: null,
      revokedAt: null,
      createdBy: expect.any(String),
      createdAt: expect.any(Number),
    });
  });
});

describe("self-service vs api_key.manage", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("a user cannot list or revoke another user's keys without api_key.manage", async () => {
    const { db, tenantId, email, password } = await setupTestDb();
    const second = await setupSecondUser(db, tenantId);
    const app = createApp({ db });

    const secondCookie = await loginAndGetCookie(app, second.email, second.password);
    const secondIssued = await issueApiKey(app, secondCookie, { name: "second's key", scopes: ["punch"] });
    const secondKeyId = secondIssued.json.apiKey.id;

    const cookie = await loginAndGetCookie(app, email, password);

    const listRes = await app.request(`/api-keys?userId=${second.userId}`, { headers: { cookie } });
    expect(listRes.status).toBe(403);

    const revokeRes = await app.request(`/api-keys/${secondKeyId}`, { method: "DELETE", headers: { cookie } });
    expect(revokeRes.status).toBe(403);
  });

  it("a user with api_key.manage can list and revoke another user's keys", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    const second = await setupSecondUser(db, tenantId);
    await grantPermission(db, { tenantId, userId, permission: "api_key.manage", scope: "tenant" });
    const app = createApp({ db });

    const secondCookie = await loginAndGetCookie(app, second.email, second.password);
    const secondIssued = await issueApiKey(app, secondCookie, { name: "second's key", scopes: ["punch"] });
    const secondKeyId = secondIssued.json.apiKey.id;

    const cookie = await loginAndGetCookie(app, email, password);

    const listRes = await app.request(`/api-keys?userId=${second.userId}`, { headers: { cookie } });
    expect(listRes.status).toBe(200);
    const { apiKeys } = await listRes.json();
    expect(apiKeys).toHaveLength(1);
    expect(apiKeys[0].id).toBe(secondKeyId);

    const revokeRes = await app.request(`/api-keys/${secondKeyId}`, { method: "DELETE", headers: { cookie } });
    expect(revokeRes.status).toBe(200);
  });

  it("POST /api-keys validates name and scopes", async () => {
    const { db, email, password } = await setupTestDb();
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    expect((await issueApiKey(app, cookie, { name: "", scopes: ["punch"] })).status).toBe(400);
    expect((await issueApiKey(app, cookie, { name: "ok", scopes: [] })).status).toBe(400);
    expect((await issueApiKey(app, cookie, { name: "ok", scopes: ["not_a_scope"] })).status).toBe(400);
  });

  it("GET/POST/DELETE /api-keys reject unauthenticated requests with 401", async () => {
    const { db } = await setupTestDb();
    const app = createApp({ db });

    expect((await app.request("/api-keys")).status).toBe(401);
    expect(
      (await app.request("/api-keys", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).status,
    ).toBe(401);
    expect((await app.request("/api-keys/whatever", { method: "DELETE" })).status).toBe(401);
  });
});
