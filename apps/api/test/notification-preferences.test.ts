/**
 * GET/PUT /settings/notifications/me, POST /settings/notifications/me/test
 * (apps/api/src/routes/notification-preferences.ts)
 *
 * 権限チェック無し(認証済み本人のみ)であること・秘密情報のマスキング・暗号化・
 * 他人の設定を読めないこと(isolation)を確認する。
 */

import { describe, expect, it } from "vitest";
import { getUserNotificationSettings } from "@kizami/db";
import { createApp } from "../src/app.js";
import { loginAndGetCookie, setupSecondUser, setupTestDb, testEncryptor } from "./support/setup.js";

describe("GET/PUT /settings/notifications/me", () => {
  it("GET succeeds with authentication only (no permission grant needed)", async () => {
    const { db, email, password } = await setupTestDb();
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const res = await app.request("/settings/notifications/me", { headers: { cookie } });
    expect(res.status).toBe(200);
  });

  it("GET returns the default shape: in-app always on, email/webhook off, no webhook configured", async () => {
    const { db, email, password } = await setupTestDb();
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const res = await app.request("/settings/notifications/me", { headers: { cookie } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.categories).toEqual({
      missing_clock_out: { inapp: true, email: false, webhook: false },
      overtime_alert: { inapp: true, email: false, webhook: false },
      leave_alert: { inapp: true, email: false, webhook: false },
      correction_alert: { inapp: true, email: false, webhook: false },
      // approval_request(2026-08-23 追加): 承認者向けカテゴリ。他カテゴリと同じ既定値
      // (アプリ内=常時ON・メール/Webhook=OFF)。
      approval_request: { inapp: true, email: false, webhook: false },
    });
    expect(body.emailAddress).toEqual({ value: null, effective: email });
    expect(body.webhookUrl).toEqual({ configured: false, preview: null });
    expect(body.updatedAt).toBeNull();
  });

  it("PUT toggles a single category without touching the others, and GET reflects it after reload", async () => {
    const { db, email, password } = await setupTestDb();
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const putRes = await app.request("/settings/notifications/me", {
      method: "PUT",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ categories: { missing_clock_out: { email: true } } }),
    });
    expect(putRes.status).toBe(200);
    const putBody = (await putRes.json()) as Record<string, unknown>;
    expect(putBody.categories).toEqual({
      missing_clock_out: { inapp: true, email: true, webhook: false },
      overtime_alert: { inapp: true, email: false, webhook: false },
      leave_alert: { inapp: true, email: false, webhook: false },
      correction_alert: { inapp: true, email: false, webhook: false },
      approval_request: { inapp: true, email: false, webhook: false },
    });

    // 再読み込み(GET)しても反映されている
    const getRes = await app.request("/settings/notifications/me", { headers: { cookie } });
    const getBody = (await getRes.json()) as Record<string, unknown>;
    expect(getBody.categories).toEqual(putBody.categories);
  });

  it("PUT sets a custom email address override (used instead of the account email)", async () => {
    const { db, email, password } = await setupTestDb();
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const res = await app.request("/settings/notifications/me", {
      method: "PUT",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ categories: {}, emailAddress: "custom@example.com" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.emailAddress).toEqual({ value: "custom@example.com", effective: "custom@example.com" });

    // 空文字を送るとクリアされ、アカウントのメールに戻る(3値ルール)。
    const clearRes = await app.request("/settings/notifications/me", {
      method: "PUT",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ categories: {}, emailAddress: "" }),
    });
    const clearBody = (await clearRes.json()) as Record<string, unknown>;
    expect(clearBody.emailAddress).toEqual({ value: null, effective: email });
  });

  it("PUT rejects an emailAddress without '@'", async () => {
    const { db, email, password } = await setupTestDb();
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const res = await app.request("/settings/notifications/me", {
      method: "PUT",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ categories: {}, emailAddress: "not-an-email" }),
    });
    expect(res.status).toBe(400);
  });

  it("PUT saves and masks the personal webhook URL, and stores it encrypted (enc:v1:) in the DB", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    const encryptor = testEncryptor();
    const app = createApp({ db, encryptor });
    const cookie = await loginAndGetCookie(app, email, password);

    const res = await app.request("/settings/notifications/me", {
      method: "PUT",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        categories: { missing_clock_out: { webhook: true } },
        webhookUrl: "https://hooks.slack.com/services/T111/B111/yyyyyyyy",
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.webhookUrl).toEqual({ configured: true, preview: "https://hooks.slack.com/..." });
    expect(JSON.stringify(body)).not.toContain("yyyyyyyy");

    const stored = await getUserNotificationSettings(db, { tenantId, userId });
    expect(stored?.webhookUrl?.startsWith("enc:v1:")).toBe(true);
    expect(stored?.webhookUrl).not.toContain("yyyyyyyy");
    await expect(encryptor.decrypt(stored!.webhookUrl!)).resolves.toBe(
      "https://hooks.slack.com/services/T111/B111/yyyyyyyy",
    );
  });

  it("PUT rejects an invalid (non-http) webhook URL", async () => {
    const { db, email, password } = await setupTestDb();
    const app = createApp({ db, encryptor: testEncryptor() });
    const cookie = await loginAndGetCookie(app, email, password);

    const res = await app.request("/settings/notifications/me", {
      method: "PUT",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ categories: {}, webhookUrl: "not-a-url" }),
    });
    expect(res.status).toBe(400);
  });

  it("PUT rejects a new webhookUrl with 503 when no encryption key is configured (no plaintext fallback)", async () => {
    const { db, email, password } = await setupTestDb();
    const app = createApp({ db }); // encryptor 未指定
    const cookie = await loginAndGetCookie(app, email, password);

    const res = await app.request("/settings/notifications/me", {
      method: "PUT",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ categories: {}, webhookUrl: "https://hooks.slack.com/services/T/B/x" }),
    });
    expect(res.status).toBe(503);

    // 秘密情報を含まない更新(カテゴリのON/OFF)は encryptor が無くても通る。
    const okRes = await app.request("/settings/notifications/me", {
      method: "PUT",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ categories: { missing_clock_out: { email: true } } }),
    });
    expect(okRes.status).toBe(200);
  });

  it("each user only sees and updates their own settings (isolation)", async () => {
    const { db, tenantId, email: email1, password: password1 } = await setupTestDb();
    const { email: email2, password: password2 } = await setupSecondUser(db, tenantId);
    const app = createApp({ db });

    const cookie1 = await loginAndGetCookie(app, email1, password1);
    await app.request("/settings/notifications/me", {
      method: "PUT",
      headers: { "content-type": "application/json", cookie: cookie1 },
      body: JSON.stringify({ categories: { missing_clock_out: { email: true } }, emailAddress: "user1-custom@example.com" }),
    });

    const cookie2 = await loginAndGetCookie(app, email2, password2);
    const res2 = await app.request("/settings/notifications/me", { headers: { cookie: cookie2 } });
    const body2 = (await res2.json()) as Record<string, unknown>;

    // user2 は user1 の変更の影響を受けない(既定値のまま)。
    expect(body2.categories).toEqual({
      missing_clock_out: { inapp: true, email: false, webhook: false },
      overtime_alert: { inapp: true, email: false, webhook: false },
      leave_alert: { inapp: true, email: false, webhook: false },
      correction_alert: { inapp: true, email: false, webhook: false },
      approval_request: { inapp: true, email: false, webhook: false },
    });
    expect(body2.emailAddress).toEqual({ value: null, effective: email2 });

    const res1Again = await app.request("/settings/notifications/me", { headers: { cookie: cookie1 } });
    const body1Again = (await res1Again.json()) as Record<string, unknown>;
    expect(body1Again.emailAddress).toEqual({ value: "user1-custom@example.com", effective: "user1-custom@example.com" });
  });

  it("PUT rejects unauthenticated requests", async () => {
    const { db } = await setupTestDb();
    const app = createApp({ db });

    const res = await app.request("/settings/notifications/me", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ categories: {} }),
    });
    expect(res.status).toBe(401);
  });
});

describe("POST /settings/notifications/me/test", () => {
  it("returns 400 not_configured when no personal webhook is set", async () => {
    const { db, email, password } = await setupTestDb();
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const res = await app.request("/settings/notifications/me/test", { method: "POST", headers: { cookie } });
    expect(res.status).toBe(400);
  });

  it("sends a test message to the configured personal webhook only", async () => {
    const { db, email, password } = await setupTestDb();
    const encryptor = testEncryptor();
    const hits: string[] = [];
    const fetchImpl = (async (input: RequestInfo | URL) => {
      hits.push(typeof input === "string" ? input : input.toString());
      return new Response(null, { status: 200 });
    }) as typeof fetch;
    const app = createApp({ db, encryptor, notify: { fetchImpl } });
    const cookie = await loginAndGetCookie(app, email, password);

    await app.request("/settings/notifications/me", {
      method: "PUT",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ categories: {}, webhookUrl: "https://personal-test.example/webhook" }),
    });

    const res = await app.request("/settings/notifications/me/test", { method: "POST", headers: { cookie } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { result: { channel: string; ok: boolean } | null };
    expect(body.result).toEqual({ channel: "webhook", ok: true });
    expect(hits).toEqual(["https://personal-test.example/webhook"]);
  });
});
