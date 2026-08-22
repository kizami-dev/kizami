import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { auditLogs } from "@kizami/db";
import { createApp } from "../src/app.js";
import { grantPermission, loginAndGetCookie, setupTestDb } from "./support/setup.js";

const PERMISSION = "notification.settings.manage";
const VALID_KEY = "leave.mandatory-five-days";

describe("GET /help/overrides", () => {
  it("is readable with authentication alone (no permission required)", async () => {
    const { db, email, password } = await setupTestDb();
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const res = await app.request("/help/overrides", { headers: { cookie } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ overrides: {}, workRulesUrl: null });
  });

  it("requires authentication", async () => {
    const { db } = await setupTestDb();
    const app = createApp({ db });
    const res = await app.request("/help/overrides");
    expect(res.status).toBe(401);
  });
});

describe("PUT/DELETE /help/overrides/:key", () => {
  it("PUT returns 403 without notification.settings.manage", async () => {
    const { db, email, password } = await setupTestDb();
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const res = await app.request(`/help/overrides/${VALID_KEY}`, {
      method: "PUT",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ bodyMd: "申請は前日までにお願いします" }),
    });
    expect(res.status).toBe(403);
  });

  it("DELETE returns 403 without notification.settings.manage", async () => {
    const { db, email, password } = await setupTestDb();
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const res = await app.request(`/help/overrides/${VALID_KEY}`, { method: "DELETE", headers: { cookie } });
    expect(res.status).toBe(403);
  });

  it("PUT rejects a help_key that does not exist in @kizami/help-content's HelpKey", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: PERMISSION, scope: "tenant" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const res = await app.request("/help/overrides/not.a.real.key", {
      method: "PUT",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ bodyMd: "本文" }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_help_key" });
  });

  it("DELETE also rejects a help_key that does not exist", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: PERMISSION, scope: "tenant" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const res = await app.request("/help/overrides/not.a.real.key", { method: "DELETE", headers: { cookie } });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_help_key" });
  });

  it("PUT rejects a non-string bodyMd", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: PERMISSION, scope: "tenant" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const res = await app.request(`/help/overrides/${VALID_KEY}`, {
      method: "PUT",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ bodyMd: 123 }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_body_md" });
  });

  it("PUT persists a company rule, GET (auth-only) returns it, and an audit log entry is recorded", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: PERMISSION, scope: "tenant" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const putRes = await app.request(`/help/overrides/${VALID_KEY}`, {
      method: "PUT",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ bodyMd: "申請は取得日の前日までにお願いします。" }),
    });
    expect(putRes.status).toBe(200);
    const putBody = await putRes.json();
    expect(putBody.helpKey).toBe(VALID_KEY);
    expect(putBody.bodyMd).toBe("申請は取得日の前日までにお願いします。");

    const getRes = await app.request("/help/overrides", { headers: { cookie } });
    const getBody = await getRes.json();
    expect(getBody.overrides[VALID_KEY]?.bodyMd).toBe("申請は取得日の前日までにお願いします。");
    expect(typeof getBody.overrides[VALID_KEY]?.updatedAt).toBe("number");

    const rows = await db.select().from(auditLogs).where(eq(auditLogs.tenantId, tenantId));
    const entry = rows.find((r) => r.action === "help_override.update");
    expect(entry).toBeDefined();
    expect(entry?.target).toBe(`help_override:${VALID_KEY}`);
  });

  it("PUT with an empty bodyMd deletes the override, and GET no longer returns it", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: PERMISSION, scope: "tenant" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    await app.request(`/help/overrides/${VALID_KEY}`, {
      method: "PUT",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ bodyMd: "本文" }),
    });

    const deleteViaPut = await app.request(`/help/overrides/${VALID_KEY}`, {
      method: "PUT",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ bodyMd: "" }),
    });
    expect(deleteViaPut.status).toBe(200);
    expect(await deleteViaPut.json()).toEqual({ deleted: true });

    const getRes = await app.request("/help/overrides", { headers: { cookie } });
    expect((await getRes.json()).overrides).toEqual({});

    const rows = await db.select().from(auditLogs).where(eq(auditLogs.tenantId, tenantId));
    expect(rows.some((r) => r.action === "help_override.delete")).toBe(true);
  });

  it("DELETE removes an existing override", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: PERMISSION, scope: "tenant" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    await app.request(`/help/overrides/${VALID_KEY}`, {
      method: "PUT",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ bodyMd: "本文" }),
    });

    const deleteRes = await app.request(`/help/overrides/${VALID_KEY}`, { method: "DELETE", headers: { cookie } });
    expect(deleteRes.status).toBe(200);

    const getRes = await app.request("/help/overrides", { headers: { cookie } });
    expect((await getRes.json()).overrides).toEqual({});
  });
});

describe("PUT /settings/work-rules-url", () => {
  it("returns 403 without notification.settings.manage", async () => {
    const { db, email, password } = await setupTestDb();
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const res = await app.request("/settings/work-rules-url", {
      method: "PUT",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ url: "https://example.com/rules.pdf" }),
    });
    expect(res.status).toBe(403);
  });

  it("rejects a non-http(s) URL", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: PERMISSION, scope: "tenant" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const res = await app.request("/settings/work-rules-url", {
      method: "PUT",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ url: "javascript:alert(1)" }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_url" });
  });

  it("persists the URL and GET /help/overrides reflects it; an empty string clears it", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: PERMISSION, scope: "tenant" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const putRes = await app.request("/settings/work-rules-url", {
      method: "PUT",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ url: "https://example.com/rules.pdf" }),
    });
    expect(putRes.status).toBe(200);
    expect(await putRes.json()).toEqual({ workRulesUrl: "https://example.com/rules.pdf" });

    const getRes = await app.request("/help/overrides", { headers: { cookie } });
    expect((await getRes.json()).workRulesUrl).toBe("https://example.com/rules.pdf");

    const clearRes = await app.request("/settings/work-rules-url", {
      method: "PUT",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ url: "" }),
    });
    expect(await clearRes.json()).toEqual({ workRulesUrl: null });

    const rows = await db.select().from(auditLogs).where(eq(auditLogs.tenantId, tenantId));
    expect(rows.some((r) => r.action === "work_rules_url.update")).toBe(true);
  });
});
