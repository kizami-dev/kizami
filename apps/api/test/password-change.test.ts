/**
 * ログイン中の本人によるパスワード変更(routes/auth-password.ts、POST /auth/password/change)。
 * 判断点は同ファイル冒頭のコメントを参照。
 */

import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { auditLogs, authCredentials, createPasswordResetToken, issueSelfServicePasswordResetToken, findPasswordResetTokenByHash } from "@kizami/db";
import { createApp } from "../src/app.js";
import { RATE_LIMITS } from "../src/lib/rate-limit.js";
import { loginAndGetCookie, setupTestDb } from "./support/setup.js";

const FIXED_NOW = new Date("2026-06-15T03:00:00.000Z");
const NEW_PASSWORD = "a brand new horse battery staple";

function change(app: ReturnType<typeof createApp>, cookie: string | undefined, body: unknown) {
  return app.request("/auth/password/change", {
    method: "POST",
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
}

function login(app: ReturnType<typeof createApp>, email: string, password: string) {
  return app.request("/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
}

describe("POST /auth/password/change", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(FIXED_NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("正常系: ハッシュが更新され、今のセッションは残り、ほかのセッションは失効し、監査ログが残る。APIキーは生きている", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    const app = createApp({ db });
    const current = await loginAndGetCookie(app, email, password);
    const otherDevice = await loginAndGetCookie(app, email, password);

    // APIキー(人のログインとは別系統)。パスワード変更では失効しない。
    const keyRes = await app.request("/api-keys", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: current },
      body: JSON.stringify({ name: "reader", scopes: ["punch"] }),
    });
    expect(keyRes.status).toBe(201);
    const apiKeyToken = ((await keyRes.json()) as { apiKey: { token: string } }).apiKey.token;

    const [before] = await db.select().from(authCredentials).where(eq(authCredentials.userId, userId));

    const res = await change(app, current, { currentPassword: password, newPassword: NEW_PASSWORD });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ changed: true, otherSessionsRevoked: true });

    const [after] = await db.select().from(authCredentials).where(eq(authCredentials.userId, userId));
    expect(after?.passwordHash).not.toBe(before?.passwordHash);

    expect((await app.request("/me", { headers: { cookie: current } })).status).toBe(200);
    expect((await app.request("/me", { headers: { cookie: otherDevice } })).status).toBe(401);

    expect((await login(app, email, NEW_PASSWORD)).status).toBe(200);
    expect((await login(app, email, password)).status).toBe(401);

    const keyUse = await app.request("/punches?from=0&to=999999999999", { headers: { authorization: `Bearer ${apiKeyToken}` } });
    expect(keyUse.status).toBe(200);

    const logs = await db.select().from(auditLogs).where(eq(auditLogs.action, "auth.password_change"));
    expect(logs).toHaveLength(1);
    expect(logs[0]?.tenantId).toBe(tenantId);
    expect(logs[0]?.actorId).toBe(userId);
    expect(logs[0]?.target).toBe(`user:${userId}`);
  });

  it("変更後は、既存の再設定トークン(管理者発行・本人発行の両方)が無効になる", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);
    await createPasswordResetToken(db, { tenantId, userId, tokenHash: "admin-h", expiresAt: 10_000_000_000, createdBy: userId, createdAt: 0 });
    await issueSelfServicePasswordResetToken(db, { tenantId, userId, tokenHash: "self-h", expiresAt: 10_000_000_000, createdAt: 0 });

    expect((await change(app, cookie, { currentPassword: password, newPassword: NEW_PASSWORD })).status).toBe(200);

    expect((await findPasswordResetTokenByHash(db, "admin-h"))?.revokedAt).not.toBeNull();
    expect((await findPasswordResetTokenByHash(db, "self-h"))?.revokedAt).not.toBeNull();
  });

  it("現在のパスワードが違えば 400 invalid_current_password で、何も変わらない", async () => {
    const { db, userId, email, password } = await setupTestDb();
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);
    const other = await loginAndGetCookie(app, email, password);
    const [before] = await db.select().from(authCredentials).where(eq(authCredentials.userId, userId));

    const res = await change(app, cookie, { currentPassword: "wrong wrong wrong wrong", newPassword: NEW_PASSWORD });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_current_password" });

    const [after] = await db.select().from(authCredentials).where(eq(authCredentials.userId, userId));
    expect(after?.passwordHash).toBe(before?.passwordHash);
    expect((await app.request("/me", { headers: { cookie: other } })).status).toBe(200);
    expect(await db.select().from(auditLogs).where(eq(auditLogs.action, "auth.password_change"))).toHaveLength(0);
  });

  it("新しいパスワードがポリシー違反(12文字未満・非文字列)なら 400 invalid_new_password", async () => {
    const { db, email, password } = await setupTestDb();
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    for (const newPassword of ["short", "", 123456789012, undefined]) {
      const res = await change(app, cookie, { currentPassword: password, newPassword });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid_new_password", minLength: 12 });
    }
  });

  it("現在と同じパスワードは 400 same_password", async () => {
    const { db, email, password } = await setupTestDb();
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);
    const res = await change(app, cookie, { currentPassword: password, newPassword: password });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "same_password" });
  });

  it("不正な body は 400 invalid_body", async () => {
    const { db, email, password } = await setupTestDb();
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);
    expect((await change(app, cookie, { newPassword: NEW_PASSWORD })).status).toBe(400);
    const raw = await app.request("/auth/password/change", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: "not json",
    });
    expect(raw.status).toBe(400);
  });

  it("パスワード資格情報が無いユーザー(SSO のみ等)は 409 no_password_credential", async () => {
    const { db, userId, email, password } = await setupTestDb();
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);
    await db.delete(authCredentials).where(eq(authCredentials.userId, userId));

    const res = await change(app, cookie, { currentPassword: password, newPassword: NEW_PASSWORD });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "no_password_credential" });
  });

  it("未認証は 401", async () => {
    const { db } = await setupTestDb();
    const app = createApp({ db });
    const res = await change(app, undefined, { currentPassword: "x", newPassword: NEW_PASSWORD });
    expect(res.status).toBe(401);
  });

  it("APIキー認証では触れない(403)", async () => {
    const { db, email, password } = await setupTestDb();
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);
    const keyRes = await app.request("/api-keys", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ name: "k", scopes: ["punch"] }),
    });
    const token = ((await keyRes.json()) as { apiKey: { token: string } }).apiKey.token;
    const res = await app.request("/auth/password/change", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ currentPassword: password, newPassword: NEW_PASSWORD }),
    });
    expect(res.status).toBe(403);
  });

  it("レート制限: ip+userId で 15分10回を超えると 429(現在のパスワードの総当たり対策)", async () => {
    const { db, email, password } = await setupTestDb();
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    for (let i = 0; i < RATE_LIMITS.passwordChangePerIpUser.max; i += 1) {
      const res = await change(app, cookie, { currentPassword: "wrong wrong wrong wrong", newPassword: NEW_PASSWORD });
      expect(res.status).toBe(400);
    }
    const limited = await change(app, cookie, { currentPassword: password, newPassword: NEW_PASSWORD });
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).not.toBeNull();
  });
});
