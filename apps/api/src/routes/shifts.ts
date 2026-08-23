/**
 * GET/POST /shifts/plans, PUT /shifts/plans/:id/days, POST /shifts/plans/:id/publish,
 * GET /shifts/plans/:id/history, GET /shifts/me
 *
 * シフト表(shift_plans / shift_days)の作成・一括設定・確定・履歴・本人閲覧。
 * 参照: docs/design/shift-work.md 決定事項1・2・3、packages/db/src/queries/shifts.ts。
 *
 * 権限(routes/settings/permissions.ts の SHIFT_MANAGE_PERMISSION 定義コメント参照):
 * すべての書き込み(create/PUT days/publish)と他者分の閲覧(GET /plans に他者の userId・
 * GET /plans/:id/history)は SHIFT_MANAGE_PERMISSION を department スコープ以上で要求する。
 * 本人のシフト閲覧(GET /shifts/me、GET /shifts/plans に userId 省略 or 自分自身)は
 * セルフサービスとして権限不要(shift-work.md「今回はセルフサービス」原則)。
 *
 * スコープ外・存在しない対象は 403 ではなく 404 にする(apps/api/src/routes/attendance.ts の
 * GET /attendance/monthly と同じ判断: 権限を持つ actor に他部署のリソースIDの存在を
 * 推測されないため)。actor が SHIFT_MANAGE_PERMISSION を一切持たない場合は
 * requirePermission が先に 403 を返す(これは actor 自身の話であり対象IDの存在を
 * 推測させる情報ではないため)。
 */

import { Hono, type Context } from "hono";
import {
  getEffectiveSettingsVersion,
  getShiftPatternById,
  getShiftPlanById,
  insertAuditLog,
  insertShiftPlan,
  listShiftDayHistoryForPlan,
  listShiftPlans,
  listValidShiftDaysForPlan,
  listValidShiftDaysInRange,
  publishShiftPlan,
  upsertShiftDaysForPlan,
  type Database,
  type ShiftDayFields,
  type ShiftDayRow,
  type ShiftPlan,
} from "@kizami/db";
import type { AppEnv } from "../auth/middleware.js";
import { requirePermission } from "../authz.js";
import { hasSufficientLegalHolidays } from "../lib/shift-legal-holiday.js";
import { resolveAccessibleUserIds } from "../lib/scope.js";
import { Temporal } from "../lib/temporal.js";
import { dateFromEpochDay, epochDayFromDate, nowMinutes } from "../lib/time.js";
import { SHIFT_MANAGE_PERMISSION } from "./settings/permissions.js";

const LOCAL_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const VALID_DAY_TYPES = new Set(["work", "legal_holiday", "non_working"]);

function isValidLocalDate(value: unknown): value is string {
  return typeof value === "string" && LOCAL_DATE_RE.test(value);
}

function isValidMinutesOfDay(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 1439;
}

async function parseJsonRecord(c: Context<AppEnv>): Promise<Record<string, unknown> | null> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return null;
  }
  if (typeof body !== "object" || body === null) return null;
  return body as Record<string, unknown>;
}

function serializePlan(p: ShiftPlan) {
  return {
    id: p.id,
    userId: p.userId,
    periodStart: p.periodStart,
    periodEnd: p.periodEnd,
    publishedAt: p.publishedAt,
    publishedBy: p.publishedBy,
    createdAt: p.createdAt,
  };
}

function serializeShiftDay(r: ShiftDayRow) {
  return {
    id: r.id,
    date: r.date,
    dayType: r.dayType,
    startMinutes: r.startMinutes,
    endMinutes: r.endMinutes,
    breakMinutes: r.breakMinutes,
    patternId: r.patternId,
    planId: r.planId,
    supersedesId: r.supersedesId,
    createdBy: r.createdBy,
    createdAt: r.createdAt,
  };
}

/** actor が SHIFT_MANAGE_PERMISSION で targetUserId を操作対象にできるか(department スコープ以上を要求)。 */
async function isUserInShiftManageScope(c: Context<AppEnv>, db: Database, targetUserId: string): Promise<boolean> {
  requirePermission(c, SHIFT_MANAGE_PERMISSION, "department");
  const user = c.get("user");
  const permissions = c.get("permissions");
  const accessible = await resolveAccessibleUserIds(db, {
    actor: { id: user.id, tenantId: user.tenantId, permissions },
    permission: SHIFT_MANAGE_PERMISSION,
  });
  return accessible === "all" || accessible.has(targetUserId);
}

/**
 * plan を id で取得し、actor の SHIFT_MANAGE_PERMISSION スコープ内であることまで確認する。
 * 権限が無ければ requirePermission が 403、plan が存在しない/スコープ外なら null を返す
 * (呼び出し側は null を 404 として扱う — ファイル冒頭コメント参照)。
 */
async function loadShiftPlanInScope(c: Context<AppEnv>, db: Database, planId: string): Promise<ShiftPlan | null> {
  requirePermission(c, SHIFT_MANAGE_PERMISSION, "department");
  const user = c.get("user");
  const plan = await getShiftPlanById(db, { tenantId: user.tenantId, id: planId });
  if (!plan) return null;

  const permissions = c.get("permissions");
  const accessible = await resolveAccessibleUserIds(db, {
    actor: { id: user.id, tenantId: user.tenantId, permissions },
    permission: SHIFT_MANAGE_PERMISSION,
  });
  if (accessible !== "all" && !accessible.has(plan.userId)) return null;
  return plan;
}

interface NormalizedDayInput extends ShiftDayFields {
  date: string;
}

/**
 * PUT /shifts/plans/:id/days のリクエストボディ(`days` 配列の1要素)を検証・正規化する。
 * `patternId` 指定ならパターンの値を、個別指定なら渡された値をそのまま採用する
 * (docs/design/shift-work.md 決定事項2「パターン割当+個別編集」)。
 * 失敗時はエラーコード文字列を返す(呼び出し側が 400 に変換する)。
 */
async function normalizeDayInput(
  db: Database,
  tenantId: string,
  plan: ShiftPlan,
  raw: unknown,
): Promise<NormalizedDayInput | string> {
  if (typeof raw !== "object" || raw === null) return "invalid_day";
  const v = raw as Record<string, unknown>;

  if (!isValidLocalDate(v.date)) return "invalid_date";
  const date = v.date;
  if (date < plan.periodStart || date > plan.periodEnd) return "date_out_of_period";

  if (typeof v.patternId === "string") {
    const pattern = await getShiftPatternById(db, { tenantId, id: v.patternId });
    if (!pattern) return "invalid_pattern_id";
    if (pattern.archivedAt !== null) return "archived_pattern";
    return {
      date,
      dayType: pattern.dayType,
      startMinutes: pattern.startMinutes,
      endMinutes: pattern.endMinutes,
      breakMinutes: pattern.breakMinutes,
      patternId: pattern.id,
    };
  }

  if (typeof v.dayType !== "string" || !VALID_DAY_TYPES.has(v.dayType)) return "invalid_day_type";
  const dayType = v.dayType;

  if (dayType !== "work") {
    // work 以外は start/end/break を常に0にする契約(engine の ShiftDay、types.ts 参照)。
    // リクエストの値は検証せず無視する(shift-patterns.ts の POST と同じ扱い)。
    return { date, dayType, startMinutes: 0, endMinutes: 0, breakMinutes: 0, patternId: null };
  }

  if (!isValidMinutesOfDay(v.startMinutes) || !isValidMinutesOfDay(v.endMinutes)) return "invalid_minutes";
  if (typeof v.breakMinutes !== "number" || !Number.isInteger(v.breakMinutes) || v.breakMinutes < 0) return "invalid_break_minutes";

  return { date, dayType, startMinutes: v.startMinutes, endMinutes: v.endMinutes, breakMinutes: v.breakMinutes, patternId: null };
}

export function createShiftsRoutes(db: Database) {
  const app = new Hono<AppEnv>();

  // ---- GET /shifts/me?from=&to=(本人。セルフサービス、権限不要) ----
  app.get("/me", async (c) => {
    const user = c.get("user");
    const from = c.req.query("from");
    const to = c.req.query("to");
    if (!isValidLocalDate(from) || !isValidLocalDate(to) || from > to) {
      return c.json({ error: "invalid_range" }, 400);
    }

    const rows = await listValidShiftDaysInRange(db, { tenantId: user.tenantId, userId: user.id, fromDate: from, toDate: to });
    return c.json({ shifts: rows.map(serializeShiftDay) });
  });

  // ---- GET /shifts/plans?userId=&periodStart= ----
  app.get("/plans", async (c) => {
    const user = c.get("user");
    const queryUserId = c.req.query("userId");
    const targetUserId = queryUserId ?? user.id;

    if (targetUserId !== user.id) {
      if (!(await isUserInShiftManageScope(c, db, targetUserId))) {
        return c.json({ error: "not_found" }, 404);
      }
    }

    const periodStart = c.req.query("periodStart");
    if (periodStart !== undefined && !isValidLocalDate(periodStart)) {
      return c.json({ error: "invalid_period_start" }, 400);
    }

    const plans = await listShiftPlans(db, { tenantId: user.tenantId, userId: targetUserId, ...(periodStart ? { periodStart } : {}) });
    const withDays = await Promise.all(
      plans.map(async (plan) => {
        const days = await listValidShiftDaysForPlan(db, { tenantId: user.tenantId, planId: plan.id });
        return { ...serializePlan(plan), days: days.map(serializeShiftDay) };
      }),
    );

    return c.json({ plans: withDays });
  });

  // ---- POST /shifts/plans(期間の器を作る。period は variable_period_start_day から算出) ----
  app.post("/plans", async (c) => {
    const body = await parseJsonRecord(c);
    if (body === null) return c.json({ error: "invalid_body" }, 400);

    if (typeof body.userId !== "string" || body.userId.length === 0) {
      return c.json({ error: "invalid_user_id" }, 400);
    }
    const targetUserId = body.userId;

    if (!(await isUserInShiftManageScope(c, db, targetUserId))) {
      return c.json({ error: "not_found" }, 404);
    }

    if (!isValidLocalDate(body.periodStart)) {
      return c.json({ error: "invalid_period_start" }, 400);
    }
    const periodStart = body.periodStart;

    const user = c.get("user");
    const effective = await getEffectiveSettingsVersion(db, { tenantId: user.tenantId, onDate: periodStart });
    if (!effective) {
      return c.json({ error: "tenant_settings_not_found" }, 409);
    }
    // periodStart は「テナントの変形期間起点日」ちょうどでなければならない(この API は
    // 期間を丸ごと算出するものであり、任意の開始日を受け付けない — ファイル冒頭の
    // 「period は variable_period_start_day から算出」の実装)。
    const periodStartDay = Number(periodStart.slice(8, 10));
    if (periodStartDay !== effective.variablePeriodStartDay) {
      return c.json({ error: "period_start_mismatch", variablePeriodStartDay: effective.variablePeriodStartDay }, 400);
    }

    const periodEnd = Temporal.PlainDate.from(periodStart).add({ months: 1 }).subtract({ days: 1 }).toString();

    const existing = await listShiftPlans(db, { tenantId: user.tenantId, userId: targetUserId, periodStart });
    if (existing.length > 0) {
      return c.json({ error: "plan_already_exists" }, 409);
    }

    const now = nowMinutes();
    const inserted = await insertShiftPlan(db, { tenantId: user.tenantId, userId: targetUserId, periodStart, periodEnd, createdAt: now });

    await insertAuditLog(db, {
      tenantId: user.tenantId,
      actorId: user.id,
      action: "shift_plan.create",
      targetType: "shift_plans",
      targetId: inserted.id,
      detail: JSON.stringify({ after: serializePlan(inserted) }),
      occurredAt: now,
    });

    return c.json({ plan: serializePlan(inserted) }, 201);
  });

  // ---- PUT /shifts/plans/:id/days(日付配列の一括設定) ----
  app.put("/plans/:id/days", async (c) => {
    const planId = c.req.param("id");
    const plan = await loadShiftPlanInScope(c, db, planId);
    if (!plan) return c.json({ error: "not_found" }, 404);

    const body = await parseJsonRecord(c);
    if (body === null) return c.json({ error: "invalid_body" }, 400);
    if (!Array.isArray(body.days) || body.days.length === 0) {
      return c.json({ error: "invalid_days" }, 400);
    }

    const user = c.get("user");
    const normalized: NormalizedDayInput[] = [];
    const seenDates = new Set<string>();
    for (const raw of body.days) {
      const result = await normalizeDayInput(db, user.tenantId, plan, raw);
      if (typeof result === "string") {
        return c.json({ error: result }, 400);
      }
      if (seenDates.has(result.date)) {
        return c.json({ error: "duplicate_date" }, 400);
      }
      seenDates.add(result.date);
      normalized.push(result);
    }

    const now = nowMinutes();
    // 確定前後を問わず同じ supersede メカニズムで書く(docs/design/shift-work.md 決定事項1、
    // packages/db/src/queries/shifts.ts の upsertShiftDaysForPlan 参照)。確定後の変更は
    // 監査ログの action で区別する(データモデル上は同一の追記操作)。
    await upsertShiftDaysForPlan(db, {
      tenantId: user.tenantId,
      userId: plan.userId,
      planId: plan.id,
      days: normalized,
      createdBy: user.id,
      createdAt: now,
    });

    await insertAuditLog(db, {
      tenantId: user.tenantId,
      actorId: user.id,
      action: plan.publishedAt !== null ? "shift_days.amend" : "shift_days.draft_upsert",
      targetType: "shift_plans",
      targetId: plan.id,
      detail: JSON.stringify({ dates: normalized.map((d) => d.date), publishedAlready: plan.publishedAt !== null }),
      occurredAt: now,
    });

    const days = await listValidShiftDaysForPlan(db, { tenantId: user.tenantId, planId: plan.id });
    return c.json({ plan: serializePlan(plan), days: days.map(serializeShiftDay) });
  });

  // ---- POST /shifts/plans/:id/publish(確定) ----
  app.post("/plans/:id/publish", async (c) => {
    const planId = c.req.param("id");
    const plan = await loadShiftPlanInScope(c, db, planId);
    if (!plan) return c.json({ error: "not_found" }, 404);

    if (plan.publishedAt !== null) {
      return c.json({ error: "already_published" }, 409);
    }

    const user = c.get("user");
    const days = await listValidShiftDaysForPlan(db, { tenantId: user.tenantId, planId: plan.id });

    // 法定休日(週1日 or 4週4日)の充足検証(docs/design/shift-work.md「法定休日の扱い」)。
    // エンジン側は未実装のためここで担う(apps/api/src/lib/shift-legal-holiday.ts 参照)。
    const ok = hasSufficientLegalHolidays({
      days: days.map((d) => ({ date: d.date, dayType: d.dayType })),
      periodStart: plan.periodStart,
      periodEnd: plan.periodEnd,
      epochDayFromDate,
      dateFromEpochDay,
    });
    if (!ok) {
      return c.json({ error: "legal_holiday_shortage" }, 409);
    }

    const now = nowMinutes();
    const published = await publishShiftPlan(db, { tenantId: user.tenantId, id: plan.id, publishedAt: now, publishedBy: user.id });
    if (!published) {
      // 直前に他のリクエストが確定させた(競合)。
      return c.json({ error: "already_published" }, 409);
    }

    await insertAuditLog(db, {
      tenantId: user.tenantId,
      actorId: user.id,
      action: "shift_plan.publish",
      targetType: "shift_plans",
      targetId: published.id,
      detail: JSON.stringify({ after: serializePlan(published) }),
      occurredAt: now,
    });

    return c.json({ plan: serializePlan(published) });
  });

  // ---- GET /shifts/plans/:id/history(変更履歴) ----
  app.get("/plans/:id/history", async (c) => {
    const planId = c.req.param("id");
    const plan = await loadShiftPlanInScope(c, db, planId);
    if (!plan) return c.json({ error: "not_found" }, 404);

    const user = c.get("user");
    const history = await listShiftDayHistoryForPlan(db, { tenantId: user.tenantId, planId: plan.id });
    return c.json({ plan: serializePlan(plan), history: history.map(serializeShiftDay) });
  });

  return app;
}
