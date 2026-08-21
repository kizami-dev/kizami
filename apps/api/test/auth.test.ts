import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
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
    expect(await res.json()).toEqual({ user: { id: userId, email, displayName, tenantId } });
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
