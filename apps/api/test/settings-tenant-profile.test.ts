import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { auditLogs } from "@kizami/db";
import { createApp } from "../src/app.js";
import { grantPermission, loginAndGetCookie, setupTestDb } from "./support/setup.js";

const PERMISSION = "alert.labor_limit.configure";

describe("GET/PUT /settings/tenant-profile", () => {
  it("GET returns 403 without alert.labor_limit.configure", async () => {
    const { db, email, password } = await setupTestDb();
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const res = await app.request("/settings/tenant-profile", { headers: { cookie } });
    expect(res.status).toBe(403);
  });

  it("PUT returns 403 without alert.labor_limit.configure", async () => {
    const { db, email, password } = await setupTestDb();
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const res = await app.request("/settings/tenant-profile", {
      method: "PUT",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        isSmallOrMediumEnterprise: false,
        isSpecialProvisionWorkplace: false,
        specialClauseEnabled: false,
      }),
    });
    expect(res.status).toBe(403);
  });

  it("GET returns the default profile (SME=true, special provision=false, special clause=false)", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: PERMISSION, scope: "tenant" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const res = await app.request("/settings/tenant-profile", { headers: { cookie } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      isSmallOrMediumEnterprise: true,
      isSpecialProvisionWorkplace: false,
      specialClauseEnabled: false,
    });
  });

  it("PUT rejects a non-boolean field", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: PERMISSION, scope: "tenant" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const res = await app.request("/settings/tenant-profile", {
      method: "PUT",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        isSmallOrMediumEnterprise: "yes",
        isSpecialProvisionWorkplace: false,
        specialClauseEnabled: false,
      }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_is_small_or_medium_enterprise" });
  });

  it("PUT persists valid values, GET reflects them, and an audit log entry is recorded", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: PERMISSION, scope: "tenant" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const putRes = await app.request("/settings/tenant-profile", {
      method: "PUT",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        isSmallOrMediumEnterprise: false,
        isSpecialProvisionWorkplace: true,
        specialClauseEnabled: true,
      }),
    });
    expect(putRes.status).toBe(200);
    expect(await putRes.json()).toEqual({
      isSmallOrMediumEnterprise: false,
      isSpecialProvisionWorkplace: true,
      specialClauseEnabled: true,
    });

    const getRes = await app.request("/settings/tenant-profile", { headers: { cookie } });
    expect(await getRes.json()).toEqual({
      isSmallOrMediumEnterprise: false,
      isSpecialProvisionWorkplace: true,
      specialClauseEnabled: true,
    });

    const rows = await db.select().from(auditLogs).where(eq(auditLogs.tenantId, tenantId));
    const entry = rows.find((r) => r.action === "tenant_profile.update");
    expect(entry).toBeDefined();
    expect(entry?.target).toBe(`tenant:${tenantId}`);
    const detail = JSON.parse(entry?.afterDigest ?? "{}");
    expect(detail.before).toEqual({
      isSmallOrMediumEnterprise: true,
      isSpecialProvisionWorkplace: false,
      specialClauseEnabled: false,
    });
    expect(detail.after).toEqual({
      isSmallOrMediumEnterprise: false,
      isSpecialProvisionWorkplace: true,
      specialClauseEnabled: true,
    });
  });
});
