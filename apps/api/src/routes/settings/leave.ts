import type { Hono } from "hono";
import { getTenantLeaveSettings, insertAuditLog, upsertTenantLeaveSettings, type Database } from "@kizami/db";
import { HOURLY_LEAVE_MAX_DAYS_MAX, HOURLY_LEAVE_MAX_DAYS_MIN } from "@kizami/leave";
import type { AppEnv } from "../../auth/middleware.js";
import { requirePermission } from "../../authz.js";
import { nowMinutes } from "../../lib/time.js";
import { LEAVE_SETTINGS_PERMISSION } from "./permissions.js";
import type { SettingsRoutesDeps } from "./shared.js";

// ---- GET/PUT /settings/leave(§5 有給休暇: 付与方式・時間単位年休・積立休暇) ----
export function registerLeaveRoutes(app: Hono<AppEnv>, db: Database, _deps: SettingsRoutesDeps) {
  app.get("/leave", async (c) => {
    requirePermission(c, LEAVE_SETTINGS_PERMISSION, "tenant");
    const user = c.get("user");
    const settings = await getTenantLeaveSettings(db, user.tenantId);
    if (!settings) {
      return c.json({
        grantMethod: "statutory",
        fixedDateMmDd: null,
        hourlyLeaveEnabled: false,
        hourlyLeaveMaxDays: 5,
        halfDayLeaveEnabled: true,
        stockConversionEnabled: false,
        stockMaxDays: 40,
        stockExpiresMonths: null,
        updatedAt: null,
        updatedBy: null,
      });
    }
    return c.json(settings);
  });

  app.put("/leave", async (c) => {
    requirePermission(c, LEAVE_SETTINGS_PERMISSION, "tenant");
    const user = c.get("user");

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid_body" }, 400);
    }
    if (typeof body !== "object" || body === null) return c.json({ error: "invalid_body" }, 400);
    const b = body as Record<string, unknown>;

    if (b.grantMethod !== "statutory" && b.grantMethod !== "fixed_date") {
      return c.json({ error: "invalid_grant_method" }, 400);
    }
    const grantMethod = b.grantMethod;

    let fixedDateMmDd: string | null = null;
    if (grantMethod === "fixed_date") {
      if (typeof b.fixedDateMmDd !== "string" || !/^\d{2}-\d{2}$/.test(b.fixedDateMmDd)) {
        return c.json({ error: "invalid_fixed_date_mm_dd" }, 400);
      }
      fixedDateMmDd = b.fixedDateMmDd;
    }

    if (typeof b.hourlyLeaveEnabled !== "boolean") return c.json({ error: "invalid_hourly_leave_enabled" }, 400);
    if (typeof b.halfDayLeaveEnabled !== "boolean") return c.json({ error: "invalid_half_day_leave_enabled" }, 400);
    if (typeof b.stockConversionEnabled !== "boolean") return c.json({ error: "invalid_stock_conversion_enabled" }, 400);

    // 労使協定で5日より少なく定めることは可能だが、5日超は法令上不可(労基法39条4項)
    if (
      typeof b.hourlyLeaveMaxDays !== "number" ||
      !Number.isInteger(b.hourlyLeaveMaxDays) ||
      b.hourlyLeaveMaxDays < HOURLY_LEAVE_MAX_DAYS_MIN ||
      b.hourlyLeaveMaxDays > HOURLY_LEAVE_MAX_DAYS_MAX
    ) {
      return c.json({ error: "invalid_hourly_leave_max_days" }, 400);
    }

    if (typeof b.stockMaxDays !== "number" || !Number.isInteger(b.stockMaxDays) || b.stockMaxDays <= 0) {
      return c.json({ error: "invalid_stock_max_days" }, 400);
    }

    let stockExpiresMonths: number | null = null;
    if (b.stockExpiresMonths !== null && b.stockExpiresMonths !== undefined) {
      if (typeof b.stockExpiresMonths !== "number" || !Number.isInteger(b.stockExpiresMonths) || b.stockExpiresMonths <= 0) {
        return c.json({ error: "invalid_stock_expires_months" }, 400);
      }
      stockExpiresMonths = b.stockExpiresMonths;
    }

    const now = nowMinutes();
    const updated = await upsertTenantLeaveSettings(db, {
      tenantId: user.tenantId,
      grantMethod,
      fixedDateMmDd,
      hourlyLeaveEnabled: b.hourlyLeaveEnabled,
      hourlyLeaveMaxDays: b.hourlyLeaveMaxDays,
      halfDayLeaveEnabled: b.halfDayLeaveEnabled,
      stockConversionEnabled: b.stockConversionEnabled,
      stockMaxDays: b.stockMaxDays,
      stockExpiresMonths,
      updatedAt: now,
      updatedBy: user.id,
    });

    await insertAuditLog(db, {
      tenantId: user.tenantId,
      actorId: user.id,
      action: "leave_settings.update",
      targetType: "tenant_leave_settings",
      targetId: user.tenantId,
      detail: JSON.stringify(updated),
      occurredAt: now,
    });

    return c.json(updated);
  });
}
