import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { sessions } from "@kizami/db";
import { createApp } from "../src/app.js";
import { SESSION_TTL_MINUTES, sessionIdFromToken } from "../src/auth/session.js";
import { loginAndGetCookie, setupTestDb } from "./support/setup.js";

describe("session lifetime", () => {
  it("issues a persistent cookie that survives browser restarts", async () => {
    const seeded = await setupTestDb();
    const app = createApp({ db: seeded.db });

    const res = await app.request("/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: seeded.email, password: seeded.password }),
    });

    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain(`Max-Age=${SESSION_TTL_MINUTES * 60}`);
  });

  it("extends an aging session when the user is still active", async () => {
    const seeded = await setupTestDb();
    const app = createApp({ db: seeded.db });
    const cookie = await loginAndGetCookie(app, seeded.email, seeded.password);

    const token = cookie.split("=")[1]?.split(";")[0] ?? "";
    const sessionId = await sessionIdFromToken(token);
    const nowMinutes = Math.floor(Date.now() / 60_000);

    // 残り1日まで消費した状態を作る
    const nearExpiry = nowMinutes + 24 * 60;
    await seeded.db.update(sessions).set({ expiresAt: nearExpiry }).where(eq(sessions.id, sessionId));

    const res = await app.request("/me", { headers: { cookie } });
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie") ?? "").toContain("kizami_session=");

    const rows = await seeded.db.select().from(sessions).where(eq(sessions.id, sessionId));
    expect(rows[0]?.expiresAt).toBeGreaterThan(nearExpiry);
  });

  it("does not touch a fresh session", async () => {
    const seeded = await setupTestDb();
    const app = createApp({ db: seeded.db });
    const cookie = await loginAndGetCookie(app, seeded.email, seeded.password);

    const res = await app.request("/me", { headers: { cookie } });
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toBeNull();
  });
});
