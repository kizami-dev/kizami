import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { auditLogs } from "@kizami/db";
import { createApp } from "../src/app.js";
import { grantPermission, loginAndGetCookie, setupTestDb } from "./support/setup.js";

const PERMISSION = "notification.settings.manage";

describe("GET/PUT /settings/privacy-contact", () => {
  it("GET returns 403 without notification.settings.manage", async () => {
    const { db, email, password } = await setupTestDb();
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const res = await app.request("/settings/privacy-contact", { headers: { cookie } });
    expect(res.status).toBe(403);
  });

  it("PUT returns 403 without notification.settings.manage", async () => {
    const { db, email, password } = await setupTestDb();
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const res = await app.request("/settings/privacy-contact", {
      method: "PUT",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ recordRetentionDescription: "x", privacyContactPoint: "y" }),
    });
    expect(res.status).toBe(403);
  });

  it("GET returns null for both fields by default", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: PERMISSION, scope: "tenant" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const res = await app.request("/settings/privacy-contact", { headers: { cookie } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ recordRetentionDescription: null, privacyContactPoint: null });
  });

  it("PUT sets both fields, GET reflects them, and an audit log entry is recorded", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: PERMISSION, scope: "tenant" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const putRes = await app.request("/settings/privacy-contact", {
      method: "PUT",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ recordRetentionDescription: "10年間保存します。", privacyContactPoint: "総務部" }),
    });
    expect(putRes.status).toBe(200);
    expect(await putRes.json()).toEqual({ recordRetentionDescription: "10年間保存します。", privacyContactPoint: "総務部" });

    const getRes = await app.request("/settings/privacy-contact", { headers: { cookie } });
    expect(await getRes.json()).toEqual({ recordRetentionDescription: "10年間保存します。", privacyContactPoint: "総務部" });

    const rows = await db.select().from(auditLogs).where(eq(auditLogs.tenantId, tenantId));
    expect(rows.some((r) => r.action === "privacy_contact.update")).toBe(true);
  });

  it("omitted fields are kept, and null/empty-string fields are cleared (3-value rule)", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: PERMISSION, scope: "tenant" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    await app.request("/settings/privacy-contact", {
      method: "PUT",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ recordRetentionDescription: "A", privacyContactPoint: "B" }),
    });

    // recordRetentionDescription を省略 → 維持。privacyContactPoint を "" → クリア。
    const putRes = await app.request("/settings/privacy-contact", {
      method: "PUT",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ privacyContactPoint: "" }),
    });
    expect(await putRes.json()).toEqual({ recordRetentionDescription: "A", privacyContactPoint: null });
  });
});
