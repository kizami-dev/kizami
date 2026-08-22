import { describe, expect, it, vi } from "vitest";
import { auditLogs, getNotificationSettings, upsertNotificationSettings, type Database } from "@kizami/db";
import { eq } from "drizzle-orm";
import { createEncryptor, type Encryptor } from "@kizami/crypto";
import type { SmtpChannelConfig, SmtpSendFn } from "@kizami/notify";
import { createApp } from "../src/app.js";
import { grantPermission, loginAndGetCookie, setupTestDb } from "./support/setup.js";

async function auditActionsFor(db: Database, tenantId: string): Promise<string[]> {
  const rows = await db.select().from(auditLogs).where(eq(auditLogs.tenantId, tenantId));
  return rows.map((r) => r.action);
}

/** テスト専用の固定鍵から Encryptor を作る(暗号化を有効にした状態を再現するため)。 */
function testEncryptor(): Encryptor {
  const keyBytes = new Uint8Array(32).fill(7);
  let binary = "";
  for (const b of keyBytes) binary += String.fromCharCode(b);
  return createEncryptor(btoa(binary));
}

describe("GET/PUT /settings/notifications", () => {
  it("GET returns 403 without notification.settings.manage", async () => {
    const { db, email, password } = await setupTestDb();
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const res = await app.request("/settings/notifications", { headers: { cookie } });
    expect(res.status).toBe(403);
  });

  it("PUT returns 403 without notification.settings.manage", async () => {
    const { db, email, password } = await setupTestDb();
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const res = await app.request("/settings/notifications", {
      method: "PUT",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ webhookEnabled: false, smtpEnabled: false }),
    });
    expect(res.status).toBe(403);
  });

  it("GET returns the default (unconfigured) shape with the permission granted", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: "notification.settings.manage", scope: "tenant" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const res = await app.request("/settings/notifications", { headers: { cookie } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      webhookEnabled: false,
      webhookUrl: { configured: false, preview: null },
      smtpEnabled: false,
      smtpHost: null,
      smtpPort: null,
      smtpUser: null,
      smtpFrom: null,
      smtpPasswordSet: false,
      updatedAt: null,
      updatedBy: null,
    });
  });

  it("PUT saves the config and masks the webhook URL and smtp password in the response", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: "notification.settings.manage", scope: "tenant" });
    const encryptor = testEncryptor();
    const app = createApp({ db, encryptor });
    const cookie = await loginAndGetCookie(app, email, password);

    const res = await app.request("/settings/notifications", {
      method: "PUT",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        webhookEnabled: true,
        webhookUrl: "https://hooks.slack.com/services/T000/B000/xxxxxxxx",
        smtpEnabled: true,
        smtpHost: "smtp.example.com",
        smtpPort: 587,
        smtpUser: "kizami@example.com",
        smtpFrom: "kizami@example.com",
        smtpPassword: "super-secret",
      }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.webhookUrl).toEqual({ configured: true, preview: "https://hooks.slack.com/..." });
    expect(body.smtpPasswordSet).toBe(true);
    // 秘密情報そのものはレスポンスに一切含まれない
    expect(JSON.stringify(body)).not.toContain("super-secret");
    expect(JSON.stringify(body)).not.toContain("T000/B000/xxxxxxxx");

    // DB には暗号化(enc:v1:<iv>:<ciphertext>)された状態で保存されている(平文はどこにも残らない)。
    // DB を直接読んで確認する。
    const stored = await getNotificationSettings(db, tenantId);
    expect(stored?.webhookUrl?.startsWith("enc:v1:")).toBe(true);
    expect(stored?.smtpPassword?.startsWith("enc:v1:")).toBe(true);
    expect(stored?.webhookUrl).not.toContain("T000/B000/xxxxxxxx");
    expect(stored?.smtpPassword).not.toBe("super-secret");
    // 保存されている暗号文は同じ鍵で復号すれば元の値に戻る
    await expect(encryptor.decrypt(stored!.webhookUrl!)).resolves.toBe(
      "https://hooks.slack.com/services/T000/B000/xxxxxxxx",
    );
    await expect(encryptor.decrypt(stored!.smtpPassword!)).resolves.toBe("super-secret");

    expect(await auditActionsFor(db, tenantId)).toEqual(["notification_settings.update"]);
  });

  it("PUT rejects a webhookUrl/smtpPassword update when no encryption key is configured (503)", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: "notification.settings.manage", scope: "tenant" });
    const app = createApp({ db }); // encryptor 未指定 = 鍵未設定と同じ

    const cookie = await loginAndGetCookie(app, email, password);

    const webhookRes = await app.request("/settings/notifications", {
      method: "PUT",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        webhookEnabled: true,
        webhookUrl: "https://hooks.slack.com/services/xxx",
        smtpEnabled: false,
      }),
    });
    expect(webhookRes.status).toBe(503);
    expect(await webhookRes.json()).toEqual({ error: "encryption_unavailable" });

    const smtpRes = await app.request("/settings/notifications", {
      method: "PUT",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        webhookEnabled: false,
        smtpEnabled: true,
        smtpHost: "smtp.example.com",
        smtpPort: 587,
        smtpFrom: "kizami@example.com",
        smtpPassword: "super-secret",
      }),
    });
    expect(smtpRes.status).toBe(503);
    expect(await smtpRes.json()).toEqual({ error: "encryption_unavailable" });

    // どちらの PUT も何も保存していない
    expect(await getNotificationSettings(db, tenantId)).toBeNull();
  });

  it("PUT without an encryption key still succeeds when the update contains no secrets (toggle only)", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: "notification.settings.manage", scope: "tenant" });
    const app = createApp({ db }); // encryptor 未指定
    const cookie = await loginAndGetCookie(app, email, password);

    const res = await app.request("/settings/notifications", {
      method: "PUT",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ webhookEnabled: false, smtpEnabled: false }),
    });
    expect(res.status).toBe(200);

    const stored = await getNotificationSettings(db, tenantId);
    expect(stored?.webhookEnabled).toBe(false);
    expect(stored?.webhookUrl).toBeNull();
  });

  it("a plaintext value saved before encryption was configured remains readable, and gets encrypted on the next save", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: "notification.settings.manage", scope: "tenant" });

    // 暗号化が導入される前に平文で保存されていたデータを直接投入する(後方互換のシミュレーション)。
    await upsertNotificationSettings(db, {
      tenantId,
      webhookEnabled: true,
      webhookUrl: "https://hooks.slack.com/services/legacy-plaintext",
      smtpEnabled: false,
      smtpHost: null,
      smtpPort: null,
      smtpUser: null,
      smtpPassword: null,
      smtpFrom: null,
      updatedAt: 0,
      updatedBy: userId,
    });

    const encryptor = testEncryptor();
    const app = createApp({ db, encryptor });
    const cookie = await loginAndGetCookie(app, email, password);

    // 平文のまま読める(後方互換)
    const getRes = await app.request("/settings/notifications", { headers: { cookie } });
    expect(getRes.status).toBe(200);
    expect((await getRes.json() as Record<string, unknown>).webhookUrl).toEqual({
      configured: true,
      preview: "https://hooks.slack.com/...",
    });

    // 同じ値を含む PUT で保存し直すと暗号化される
    const putRes = await app.request("/settings/notifications", {
      method: "PUT",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        webhookEnabled: true,
        webhookUrl: "https://hooks.slack.com/services/legacy-plaintext",
        smtpEnabled: false,
      }),
    });
    expect(putRes.status).toBe(200);

    const stored = await getNotificationSettings(db, tenantId);
    expect(stored?.webhookUrl?.startsWith("enc:v1:")).toBe(true);
    await expect(encryptor.decrypt(stored!.webhookUrl!)).resolves.toBe("https://hooks.slack.com/services/legacy-plaintext");
  });

  it("an omitted smtpPassword on a later PUT keeps the existing password", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: "notification.settings.manage", scope: "tenant" });
    const encryptor = testEncryptor();
    const app = createApp({ db, encryptor });
    const cookie = await loginAndGetCookie(app, email, password);

    await app.request("/settings/notifications", {
      method: "PUT",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        webhookEnabled: false,
        smtpEnabled: true,
        smtpHost: "smtp.example.com",
        smtpPort: 587,
        smtpFrom: "kizami@example.com",
        smtpPassword: "keep-me",
      }),
    });

    const second = await app.request("/settings/notifications", {
      method: "PUT",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        webhookEnabled: false,
        smtpEnabled: true,
        smtpHost: "smtp.example.com",
        smtpPort: 2525, // 他フィールドだけ変更、smtpPassword は指定しない
        smtpFrom: "kizami@example.com",
      }),
    });
    expect(second.status).toBe(200);
    expect(((await second.json()) as { smtpPasswordSet: boolean }).smtpPasswordSet).toBe(true);

    const stored = await getNotificationSettings(db, tenantId);
    expect(stored?.smtpPassword?.startsWith("enc:v1:")).toBe(true);
    await expect(encryptor.decrypt(stored!.smtpPassword!)).resolves.toBe("keep-me");
    expect(stored?.smtpPort).toBe(2525);
  });

  it("an empty string smtpPassword clears the stored password", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: "notification.settings.manage", scope: "tenant" });
    const app = createApp({ db, encryptor: testEncryptor() });
    const cookie = await loginAndGetCookie(app, email, password);

    await app.request("/settings/notifications", {
      method: "PUT",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        webhookEnabled: false,
        smtpEnabled: true,
        smtpHost: "smtp.example.com",
        smtpPort: 587,
        smtpFrom: "kizami@example.com",
        smtpPassword: "will-be-cleared",
      }),
    });

    const cleared = await app.request("/settings/notifications", {
      method: "PUT",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        webhookEnabled: false,
        smtpEnabled: false,
        smtpHost: "smtp.example.com",
        smtpPort: 587,
        smtpFrom: "kizami@example.com",
        smtpPassword: "",
      }),
    });
    expect(cleared.status).toBe(200);
    expect(((await cleared.json()) as { smtpPasswordSet: boolean }).smtpPasswordSet).toBe(false);

    const stored = await getNotificationSettings(db, tenantId);
    expect(stored?.smtpPassword).toBeNull();
  });

  it("PUT rejects webhookEnabled=true without a webhookUrl", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: "notification.settings.manage", scope: "tenant" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const res = await app.request("/settings/notifications", {
      method: "PUT",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ webhookEnabled: true, smtpEnabled: false }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_webhook_url" });
  });

  it("PUT rejects smtpEnabled=true without a complete smtp config", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: "notification.settings.manage", scope: "tenant" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const res = await app.request("/settings/notifications", {
      method: "PUT",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ webhookEnabled: false, smtpEnabled: true }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_smtp_config" });
  });
});

describe("POST /settings/notifications/test", () => {
  it("returns 403 without notification.settings.manage", async () => {
    const { db, email, password } = await setupTestDb();
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const res = await app.request("/settings/notifications/test", { method: "POST", headers: { cookie } });
    expect(res.status).toBe(403);
  });

  it("returns 400 not_configured when nothing has been saved yet", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: "notification.settings.manage", scope: "tenant" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const res = await app.request("/settings/notifications/test", { method: "POST", headers: { cookie } });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "not_configured" });
  });

  it("returns 400 not_configured when a config row exists but both channels are disabled", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: "notification.settings.manage", scope: "tenant" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    await app.request("/settings/notifications", {
      method: "PUT",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ webhookEnabled: false, smtpEnabled: false }),
    });

    const res = await app.request("/settings/notifications/test", { method: "POST", headers: { cookie } });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "not_configured" });
  });

  it("sends a real-looking test message through injected fakes (no real network I/O) and reports per-channel results", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: "notification.settings.manage", scope: "tenant" });

    const fetchCalls: Array<{ url: RequestInfo | URL; init?: RequestInit }> = [];
    const fetchImpl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      fetchCalls.push({ url, ...(init ? { init } : {}) });
      return new Response(null, { status: 200 });
    });

    const smtpCalls: Array<{ config: SmtpChannelConfig }> = [];
    const smtpSendFn: SmtpSendFn = vi.fn(async (config) => {
      smtpCalls.push({ config });
    });

    const app = createApp({ db, notify: { fetchImpl, smtpSendFn }, encryptor: testEncryptor() });
    const cookie = await loginAndGetCookie(app, email, password);

    await app.request("/settings/notifications", {
      method: "PUT",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        webhookEnabled: true,
        webhookUrl: "https://hooks.slack.com/services/xxx",
        smtpEnabled: true,
        smtpHost: "smtp.example.com",
        smtpPort: 587,
        smtpFrom: "kizami@example.com",
        smtpPassword: "secret",
      }),
    });

    const res = await app.request("/settings/notifications/test", { method: "POST", headers: { cookie } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { results: { channel: string; ok: boolean }[] };
    expect(body.results).toHaveLength(2);
    expect(body.results.every((r) => r.ok)).toBe(true);
    expect(body.results.map((r) => r.channel).sort()).toEqual(["smtp", "webhook"]);

    expect(fetchCalls).toHaveLength(1);
    expect(JSON.parse(fetchCalls[0]!.init!.body as string).text).toContain("KIZAMI 通知テスト");

    expect(smtpCalls).toHaveLength(1);
    expect(smtpCalls[0]!.config.host).toBe("smtp.example.com");

    // 実送信は一切していない(fetchImpl/smtpSendFn は偽実装のみ)
    expect(await auditActionsFor(db, tenantId)).toEqual(["notification_settings.update", "notification_settings.test"]);
  });

  it("reports a failing channel's error without throwing", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: "notification.settings.manage", scope: "tenant" });

    const smtpSendFn: SmtpSendFn = vi.fn(async () => {
      throw new Error("smtp connection refused");
    });

    const app = createApp({ db, notify: { smtpSendFn }, encryptor: testEncryptor() });
    const cookie = await loginAndGetCookie(app, email, password);

    await app.request("/settings/notifications", {
      method: "PUT",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        webhookEnabled: false,
        smtpEnabled: true,
        smtpHost: "smtp.example.com",
        smtpPort: 587,
        smtpFrom: "kizami@example.com",
        smtpPassword: "secret",
      }),
    });

    const res = await app.request("/settings/notifications/test", { method: "POST", headers: { cookie } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ results: [{ channel: "smtp", ok: false, error: "smtp connection refused" }] });
  });

  it("a value that cannot be decrypted (key rotated) is treated as not configured: no exception, no channel dispatched", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: "notification.settings.manage", scope: "tenant" });

    const originalEncryptor = testEncryptor();
    const savingApp = createApp({ db, encryptor: originalEncryptor });
    const cookie = await loginAndGetCookie(savingApp, email, password);

    await savingApp.request("/settings/notifications", {
      method: "PUT",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        webhookEnabled: true,
        webhookUrl: "https://hooks.slack.com/services/xxx",
        smtpEnabled: false,
      }),
    });

    // 鍵が変わった状況を再現する(別鍵の Encryptor を持つ別インスタンス)。
    const rotatedKeyBytes = new Uint8Array(32).fill(9);
    let binary = "";
    for (const b of rotatedKeyBytes) binary += String.fromCharCode(b);
    const rotatedEncryptor = createEncryptor(btoa(binary));

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const readingApp = createApp({ db, encryptor: rotatedEncryptor });

    // POST /settings/notifications/test は例外で落ちず、復号できないチャネルを黙って除外する
    // (isNotificationConfigUsable は暗号化済み値の有無だけを見るので事前チェックは通過する)。
    const res = await readingApp.request("/settings/notifications/test", { method: "POST", headers: { cookie } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ results: [] });
    expect(warnSpy).toHaveBeenCalled();

    warnSpy.mockRestore();
  });
});
