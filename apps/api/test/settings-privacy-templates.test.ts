import { describe, expect, it } from "vitest";
import { tenantSettingVersions, updateTenantWorkRulesUrl, uuidv7 } from "@kizami/db";
import { createApp } from "../src/app.js";
import { grantPermission, loginAndGetCookie, setupTestDb } from "./support/setup.js";

const PERMISSION = "notification.settings.manage";

describe("GET /settings/privacy-templates", () => {
  it("returns 403 without notification.settings.manage", async () => {
    const { db, email, password } = await setupTestDb();
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const res = await app.request("/settings/privacy-templates", { headers: { cookie } });
    expect(res.status).toBe(403);
  });

  it("generates both templates with GPS disabled (setupTestDb default) and no location section", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: PERMISSION, scope: "tenant" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const res = await app.request("/settings/privacy-templates", { headers: { cookie } });
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.generatedFrom.gpsEnabled).toBe(false);
    expect(body.generatedFrom.gpsRetentionDays).toBeNull();
    expect(body.generatedFrom.tenantName).toBe("Test Tenant");
    expect(body.privacyNotice).not.toContain("位置情報");
    expect(body.privacyNotice).not.toContain("GPS");
    expect(typeof body.internalTerms).toBe("string");
    expect(body.internalTerms).toContain("代理打刻");
    expect(body.privacyNotice).toContain("この文面は KIZAMI が提供する雛形です");
    expect(body.internalTerms).toContain("この文面は KIZAMI が提供する雛形です");
  });

  it("reflects a GPS-enabled tenant setting version: the notice gains a location section and the retention days", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: PERMISSION, scope: "tenant" });

    // GPS を有効にした新しい版を追記する(effective-dated、追記専用)。
    await db.insert(tenantSettingVersions).values({
      id: uuidv7(),
      tenantId,
      effectiveFrom: "2000-01-01",
      dayBoundaryMinutes: 0,
      legalHolidayRule: JSON.stringify({ kind: "weekday", weekday: 0 }),
      breakRule: JSON.stringify({ mode: "punch" }),
      gpsEnabled: true,
      gpsRetentionDays: 90,
      createdAt: 0,
    });

    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const res = await app.request("/settings/privacy-templates", { headers: { cookie } });
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.generatedFrom.gpsEnabled).toBe(true);
    expect(body.generatedFrom.gpsRetentionDays).toBe(90);
    expect(body.privacyNotice).toContain("位置情報(GPS座標)");
    expect(body.privacyNotice).toContain("取得から90日間保存");
    // 利用規約側は GPS に言及しない(役割を分ける方針)。
    expect(body.internalTerms).not.toContain("位置情報");
  });

  it("includes the work rules URL when set, and omits it when not set", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: PERMISSION, scope: "tenant" });
    await updateTenantWorkRulesUrl(db, { tenantId, workRulesUrl: "https://example.com/work-rules.pdf" });

    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const res = await app.request("/settings/privacy-templates", { headers: { cookie } });
    const body = await res.json();

    expect(body.generatedFrom.workRulesUrl).toBe("https://example.com/work-rules.pdf");
    expect(body.privacyNotice).toContain("https://example.com/work-rules.pdf");
    expect(body.internalTerms).toContain("https://example.com/work-rules.pdf");
  });

  it("falls back to the fixed record retention text and a null contact point when unset", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: PERMISSION, scope: "tenant" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const res = await app.request("/settings/privacy-templates", { headers: { cookie } });
    const body = await res.json();

    expect(body.generatedFrom.contactPoint).toBeNull();
    expect(body.generatedFrom.recordRetentionDescription).toContain("労働基準法第109条");
    expect(body.privacyNotice).toContain("ここに開示・訂正等の請求を受け付ける窓口を記載してください");
  });

  it("uses PUT /settings/privacy-contact values once set", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: PERMISSION, scope: "tenant" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const putRes = await app.request("/settings/privacy-contact", {
      method: "PUT",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        recordRetentionDescription: "打刻記録は10年間保存します。",
        privacyContactPoint: "総務部 privacy@example.com",
      }),
    });
    expect(putRes.status).toBe(200);

    const res = await app.request("/settings/privacy-templates", { headers: { cookie } });
    const body = await res.json();

    expect(body.generatedFrom.recordRetentionDescription).toBe("打刻記録は10年間保存します。");
    expect(body.generatedFrom.contactPoint).toBe("総務部 privacy@example.com");
    expect(body.privacyNotice).toContain("総務部 privacy@example.com");
  });
});
