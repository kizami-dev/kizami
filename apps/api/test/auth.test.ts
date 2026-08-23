import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { authCredentials, tenants, users, uuidv7 } from "@kizami/db";
import { hashPassword } from "../src/auth/password.js";
import { loginAndGetCookie, setupTestDb } from "./support/setup.js";

describe("POST /auth/login", () => {
  it("succeeds with correct credentials and sets the session cookie", async () => {
    const { db, email, password, userId, displayName } = await setupTestDb();
    const app = createApp({ db });

    const res = await app.request("/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ user: { id: userId, email, displayName } });
    expect(res.headers.get("set-cookie")).toContain("kizami_session=");
    expect(res.headers.get("set-cookie")).toContain("HttpOnly");
  });

  it("rejects an incorrect password with 401", async () => {
    const { db, email } = await setupTestDb();
    const app = createApp({ db });

    const res = await app.request("/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password: "wrong-password" }),
    });

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "invalid_credentials" });
  });

  it("rejects an unknown email with 401", async () => {
    const { db } = await setupTestDb();
    const app = createApp({ db });

    const res = await app.request("/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "nobody@example.com", password: "whatever" }),
    });

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "invalid_credentials" });
  });

  it("rejects a malformed body with 400", async () => {
    const { db } = await setupTestDb();
    const app = createApp({ db });

    const res = await app.request("/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "only-email@example.com" }),
    });

    expect(res.status).toBe(400);
  });
});

describe("GET /me", () => {
  it("returns the authenticated user when the session cookie is valid", async () => {
    const { db, email, password, userId, tenantId, displayName } = await setupTestDb();
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const res = await app.request("/me", { headers: { cookie } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      user: { id: userId, email, displayName, tenantId },
      // テナント名(社名)はヘッダー表示用(2026-08-23 追加)。setupTestDb() のテナント名
      tenant: { name: "Test Tenant" },
    });
  });

  it("returns 401 without a session cookie", async () => {
    const { db } = await setupTestDb();
    const app = createApp({ db });

    const res = await app.request("/me");
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
  });

  it("returns 401 with a garbage cookie value", async () => {
    const { db } = await setupTestDb();
    const app = createApp({ db });

    const res = await app.request("/me", { headers: { cookie: "kizami_session=not-a-real-session" } });
    expect(res.status).toBe(401);
  });
});

describe("POST /auth/logout", () => {
  it("revokes the session, clears the cookie, and 401s subsequent /me calls", async () => {
    const { db, email, password } = await setupTestDb();
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const meBefore = await app.request("/me", { headers: { cookie } });
    expect(meBefore.status).toBe(200);

    const logoutRes = await app.request("/auth/logout", { method: "POST", headers: { cookie } });
    expect(logoutRes.status).toBe(204);
    const setCookieHeader = logoutRes.headers.get("set-cookie");
    expect(setCookieHeader).toContain("kizami_session=;");

    const meAfter = await app.request("/me", { headers: { cookie } });
    expect(meAfter.status).toBe(401);
  });

  it("returns 204 even without an existing session", async () => {
    const { db } = await setupTestDb();
    const app = createApp({ db });

    const res = await app.request("/auth/logout", { method: "POST" });
    expect(res.status).toBe(204);
  });
});

describe("POST /auth/login: 同一メールが複数テナントに存在する場合(2026-08-23)", () => {
  /** setupTestDb() のテナントとは別に、同じメール・任意パスワードのユーザーを持つ第2テナントを作る。 */
  async function addSecondTenantUser(
    db: Awaited<ReturnType<typeof setupTestDb>>["db"],
    email: string,
    password: string,
  ): Promise<{ tenantId: string; userId: string }> {
    const now = 0;
    const tenantId = uuidv7();
    const userId = uuidv7();
    await db.insert(tenants).values({ id: tenantId, name: "Second Tenant", createdAt: now });
    await db.insert(users).values({ id: userId, tenantId, email, name: "Same Email User", isActive: true, createdAt: now });
    await db.insert(authCredentials).values({
      id: uuidv7(),
      tenantId,
      userId,
      passwordHash: await hashPassword(password),
      createdAt: now,
      updatedAt: now,
    });
    return { tenantId, userId };
  }

  it("両テナントで同じパスワード → 409 multiple_tenants でテナント一覧(id+社名)が返る", async () => {
    const seeded = await setupTestDb();
    const second = await addSecondTenantUser(seeded.db, seeded.email, seeded.password);
    const app = createApp({ db: seeded.db });

    const res = await app.request("/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: seeded.email, password: seeded.password }),
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string; tenants: Array<{ id: string; name: string | null }> };
    expect(body.error).toBe("multiple_tenants");
    expect(body.tenants.map((t) => t.id).sort()).toEqual([seeded.tenantId, second.tenantId].sort());
    expect(body.tenants.map((t) => t.name).sort()).toEqual(["Second Tenant", "Test Tenant"]);
  });

  it("tenantId を指定して再ログインすると、そのテナントのセッションになる", async () => {
    const seeded = await setupTestDb();
    const second = await addSecondTenantUser(seeded.db, seeded.email, seeded.password);
    const app = createApp({ db: seeded.db });

    const res = await app.request("/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: seeded.email, password: seeded.password, tenantId: second.tenantId }),
    });
    expect(res.status).toBe(200);
    const cookie = res.headers.get("set-cookie") ?? "";
    const me = await app.request("/me", { headers: { cookie } });
    const meBody = (await me.json()) as { user: { tenantId: string }; tenant: { name: string | null } };
    expect(meBody.user.tenantId).toBe(second.tenantId);
    expect(meBody.tenant.name).toBe("Second Tenant");
  });

  it("パスワードが一致するテナントが1つだけなら、指定なしでそのテナントに入る", async () => {
    const seeded = await setupTestDb();
    await addSecondTenantUser(seeded.db, seeded.email, "different password entirely");
    const app = createApp({ db: seeded.db });

    const res = await app.request("/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: seeded.email, password: seeded.password }),
    });
    expect(res.status).toBe(200);
    const cookie = res.headers.get("set-cookie") ?? "";
    const me = await app.request("/me", { headers: { cookie } });
    const meBody = (await me.json()) as { user: { tenantId: string } };
    expect(meBody.user.tenantId).toBe(seeded.tenantId);
  });

  it("どのテナントともパスワードが合わなければ 401(テナント情報は一切漏れない)", async () => {
    const seeded = await setupTestDb();
    await addSecondTenantUser(seeded.db, seeded.email, "another password");
    const app = createApp({ db: seeded.db });

    const res = await app.request("/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: seeded.email, password: "wrong password" }),
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "invalid_credentials" });
  });
});
