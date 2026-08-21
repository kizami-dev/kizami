import { describe, expect, it, vi } from "vitest";
import { auditLogs, getNotificationSettings, type Database } from "@kizami/db";
import { eq } from "drizzle-orm";
import type { SmtpChannelConfig, SmtpSendFn } from "@kizami/notify";
import { createApp } from "../src/app.js";
import { grantPermission, loginAndGetCookie, setupTestDb } from "./support/setup.js";

async function auditActionsFor(db: Database, tenantId: string): Promise<string[]> {
  const rows = await db.select().from(auditLogs).where(eq(auditLogs.tenantId, tenantId));
  return rows.map((r) => r.action);
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
    const app = createApp({ db });
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

    // DB には平文で保存されている(マスクはAPI層の責務)
    const stored = await getNotificationSettings(db, tenantId);
    expect(stored?.webhookUrl).toBe("https://hooks.slack.com/services/T000/B000/xxxxxxxx");
    expect(stored?.smtpPassword).toBe("super-secret");

    expect(await auditActionsFor(db, tenantId)).toEqual(["notification_settings.update"]);
  });

  it("an omitted smtpPassword on a later PUT keeps the existing password", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: "notification.settings.manage", scope: "tenant" });
    const app = createApp({ db });
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
    expect(stored?.smtpPassword).toBe("keep-me");
    expect(stored?.smtpPort).toBe(2525);
  });

  it("an empty string smtpPassword clears the stored password", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: "notification.settings.manage", scope: "tenant" });
    const app = createApp({ db });
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

    const app = createApp({ db, notify: { fetchImpl, smtpSendFn } });
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

    const app = createApp({ db, notify: { smtpSendFn } });
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
});
