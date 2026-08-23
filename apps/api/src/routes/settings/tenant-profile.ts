import type { Hono } from "hono";
import { getTenantById, insertAuditLog, updateTenantLawProfile, type Database } from "@kizami/db";
import type { AppEnv } from "../../auth/middleware.js";
import { requirePermission } from "../../authz.js";
import { nowMinutes } from "../../lib/time.js";
import { TENANT_PROFILE_PERMISSION } from "./permissions.js";
import type { SettingsRoutesDeps } from "./shared.js";

// ---- GET/PUT /settings/tenant-profile(法令プロファイル・特別条項。2026-08-22 追加) ----
export function registerTenantProfileRoutes(app: Hono<AppEnv>, db: Database, _deps: SettingsRoutesDeps) {
  app.get("/tenant-profile", async (c) => {
    requirePermission(c, TENANT_PROFILE_PERMISSION, "tenant");
    const user = c.get("user");
    const tenant = await getTenantById(db, user.tenantId);
    if (!tenant) {
      return c.json({ error: "tenant_not_found" }, 404);
    }
    return c.json({
      isSmallOrMediumEnterprise: tenant.isSmallOrMediumEnterprise,
      isSpecialProvisionWorkplace: tenant.isSpecialProvisionWorkplace,
      specialClauseEnabled: tenant.specialClauseEnabled,
    });
  });

  app.put("/tenant-profile", async (c) => {
    requirePermission(c, TENANT_PROFILE_PERMISSION, "tenant");
    const user = c.get("user");

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid_body" }, 400);
    }
    if (typeof body !== "object" || body === null) return c.json({ error: "invalid_body" }, 400);
    const b = body as Record<string, unknown>;

    if (typeof b.isSmallOrMediumEnterprise !== "boolean") {
      return c.json({ error: "invalid_is_small_or_medium_enterprise" }, 400);
    }
    if (typeof b.isSpecialProvisionWorkplace !== "boolean") {
      return c.json({ error: "invalid_is_special_provision_workplace" }, 400);
    }
    if (typeof b.specialClauseEnabled !== "boolean") {
      return c.json({ error: "invalid_special_clause_enabled" }, 400);
    }

    const before = await getTenantById(db, user.tenantId);
    if (!before) {
      return c.json({ error: "tenant_not_found" }, 404);
    }

    const updated = await updateTenantLawProfile(db, {
      tenantId: user.tenantId,
      isSmallOrMediumEnterprise: b.isSmallOrMediumEnterprise,
      isSpecialProvisionWorkplace: b.isSpecialProvisionWorkplace,
      specialClauseEnabled: b.specialClauseEnabled,
    });

    // この3値は集計(週法定労働時間・60時間超区分・36協定の各閾値)に直接影響するため、
    // 依頼どおり変更時は必ず監査ログに残す(before/after 両方を残し、何から何に変えたか追える形にする)。
    const now = nowMinutes();
    await insertAuditLog(db, {
      tenantId: user.tenantId,
      actorId: user.id,
      action: "tenant_profile.update",
      targetType: "tenant",
      targetId: user.tenantId,
      detail: JSON.stringify({
        before: {
          isSmallOrMediumEnterprise: before.isSmallOrMediumEnterprise,
          isSpecialProvisionWorkplace: before.isSpecialProvisionWorkplace,
          specialClauseEnabled: before.specialClauseEnabled,
        },
        after: {
          isSmallOrMediumEnterprise: updated.isSmallOrMediumEnterprise,
          isSpecialProvisionWorkplace: updated.isSpecialProvisionWorkplace,
          specialClauseEnabled: updated.specialClauseEnabled,
        },
      }),
      occurredAt: now,
    });

    return c.json({
      isSmallOrMediumEnterprise: updated.isSmallOrMediumEnterprise,
      isSpecialProvisionWorkplace: updated.isSpecialProvisionWorkplace,
      specialClauseEnabled: updated.specialClauseEnabled,
    });
  });
}
