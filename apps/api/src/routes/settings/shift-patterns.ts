/**
 * GET/POST /settings/shift-patterns, POST /settings/shift-patterns/:id/archive
 *
 * シフトパターン(早番/遅番/休み等)の定義(docs/design/shift-work.md 決定事項2:
 * 「パターン割当+個別編集」の UI 粒度に対応する、パターン側の CRUD)。
 * テナント全体で共有する定義のため、GET/POST/:id/archive のいずれも
 * SHIFT_MANAGE_PERMISSION を tenant スコープで要求する(work-policy.ts と同じ扱い —
 * パターン自体は user 単位のデータではないため)。
 */

import type { Hono } from "hono";
import {
  archiveShiftPattern,
  insertAuditLog,
  insertShiftPattern,
  listShiftPatterns,
  type Database,
  type ShiftPattern,
} from "@kizami/db";
import type { AppEnv } from "../../auth/middleware.js";
import { requirePermission } from "../../authz.js";
import { nowMinutes } from "../../lib/time.js";
import { SHIFT_MANAGE_PERMISSION } from "./permissions.js";
import { parseJsonRecord, type SettingsRoutesDeps } from "./shared.js";

const VALID_DAY_TYPES = new Set(["work", "legal_holiday", "non_working"]);

function isValidMinutesOfDay(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 1439;
}

function serializeShiftPattern(p: ShiftPattern) {
  return {
    id: p.id,
    name: p.name,
    dayType: p.dayType,
    startMinutes: p.startMinutes,
    endMinutes: p.endMinutes,
    breakMinutes: p.breakMinutes,
    createdAt: p.createdAt,
    archivedAt: p.archivedAt,
  };
}

export function registerShiftPatternsRoutes(app: Hono<AppEnv>, db: Database, _deps: SettingsRoutesDeps) {
  app.get("/shift-patterns", async (c) => {
    requirePermission(c, SHIFT_MANAGE_PERMISSION, "tenant");
    const user = c.get("user");
    const includeArchived = c.req.query("includeArchived") === "true";

    const patterns = await listShiftPatterns(db, { tenantId: user.tenantId, includeArchived });
    return c.json({ patterns: patterns.map(serializeShiftPattern) });
  });

  app.post("/shift-patterns", async (c) => {
    requirePermission(c, SHIFT_MANAGE_PERMISSION, "tenant");
    const user = c.get("user");

    const body = await parseJsonRecord(c);
    if (body === null) return c.json({ error: "invalid_body" }, 400);

    if (typeof body.name !== "string" || body.name.trim().length === 0) {
      return c.json({ error: "invalid_name" }, 400);
    }
    const name = body.name;

    if (typeof body.dayType !== "string" || !VALID_DAY_TYPES.has(body.dayType)) {
      return c.json({ error: "invalid_day_type" }, 400);
    }
    const dayType = body.dayType;

    // dayType が work 以外なら start/end/break はすべて 0 に固定する(engine の ShiftDay
    // 契約 — types.ts の JSDoc 参照: 「dayType が work 以外は0にする契約」)。リクエストの値は
    // 検証すらせず無視する(work 以外の日に意味のある時間帯を持たせない設計を保存時点で担保する)。
    let startMinutes = 0;
    let endMinutes = 0;
    let breakMinutes = 0;
    if (dayType === "work") {
      if (!isValidMinutesOfDay(body.startMinutes) || !isValidMinutesOfDay(body.endMinutes)) {
        return c.json({ error: "invalid_minutes" }, 400);
      }
      if (typeof body.breakMinutes !== "number" || !Number.isInteger(body.breakMinutes) || body.breakMinutes < 0) {
        return c.json({ error: "invalid_break_minutes" }, 400);
      }
      startMinutes = body.startMinutes;
      endMinutes = body.endMinutes;
      breakMinutes = body.breakMinutes;
    }

    const now = nowMinutes();
    const inserted = await insertShiftPattern(db, {
      tenantId: user.tenantId,
      name,
      dayType,
      startMinutes,
      endMinutes,
      breakMinutes,
      createdAt: now,
    });

    await insertAuditLog(db, {
      tenantId: user.tenantId,
      actorId: user.id,
      action: "shift_pattern.create",
      targetType: "shift_patterns",
      targetId: inserted.id,
      detail: JSON.stringify({ after: serializeShiftPattern(inserted) }),
      occurredAt: now,
    });

    return c.json({ pattern: serializeShiftPattern(inserted) }, 201);
  });

  app.post("/shift-patterns/:id/archive", async (c) => {
    requirePermission(c, SHIFT_MANAGE_PERMISSION, "tenant");
    const user = c.get("user");
    const id = c.req.param("id");

    const now = nowMinutes();
    const archived = await archiveShiftPattern(db, { tenantId: user.tenantId, id, archivedAt: now });
    if (!archived) {
      // 存在しない・他テナント・既にアーカイブ済みのいずれも同じ 404 にする
      // (「既にアーカイブ済み」と「存在しない」を区別する情報的価値が薄く、work-policy.ts の
      // version_already_exists のような衝突系エラーとは性質が違う — 冪等な操作の再試行として
      // 404 を返しても呼び出し側の実害は無い)。
      return c.json({ error: "not_found" }, 404);
    }

    await insertAuditLog(db, {
      tenantId: user.tenantId,
      actorId: user.id,
      action: "shift_pattern.archive",
      targetType: "shift_patterns",
      targetId: archived.id,
      detail: JSON.stringify({ after: serializeShiftPattern(archived) }),
      occurredAt: now,
    });

    return c.json({ pattern: serializeShiftPattern(archived) });
  });
}
