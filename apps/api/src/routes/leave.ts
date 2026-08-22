/**
 * GET /leave/balance, GET /leave/requests, POST /leave/requests,
 * POST /leave/requests/:id/{approve,reject,withdraw}, POST /leave/grants,
 * POST /leave/grants/auto, POST /leave/grants/convert-expired
 *
 * 有給休暇管理(docs/requirements.md §5)。休暇申請→承認フローは routes/corrections.ts
 * (打刻修正申請)と同じ形を踏襲する: 申請→pending→承認/却下/取下げ、承認時に監査ログ
 * (自己承認は selfApproved)。v0.1/v0.2 と同じく請求フロー自体は本人スコープのみ
 * (requireSelf)。残高閲覧(GET /leave/balance?userId=)と付与管理(POST /leave/grants*)
 * のみ権限プリセット方式(requirePermission + resolveAccessibleUserIds)を使う。
 *
 * 残高・消化の計算は @kizami/leave(純関数・分単位)に委譲する。DB 層(leave_grants /
 * leave_requests)は日数・分をそのまま保存するだけで、FIFO・時効・年5日・時間単位年休の
 * 年度上限といったロジックは一切持たない。
 *
 * 締め後修正(amend, v0.4): POST /requests は元々締めガードを持たなかった(締め済み月でも
 * 作成できていた)ため変更不要。レスポンスに `targetMonthClosed` を追加し、UI が警告を
 * 出せるようにするのみ。POST /requests/:id/approve は新たに `assertAmendAllowed` を通す:
 * 対象日が締め済み月に属す場合、`closing.unlock` を持つ場合のみ承認でき、月を開けずに
 * 対象ユーザーのスナップショットを再計算・新世代保存 + closing_events に amend を追記する
 * (routes/corrections.ts の POST /:id/approve と同じ形。有給取得は集計(フレックス実績)に
 * 影響するため、打刻修正と同様に amend の対象にする)。
 */

import { Hono } from "hono";
import {
  appendClosingEvent,
  getClosingSnapshots,
  getClosingState,
  getTenantLeaveSettings,
  getUserById,
  insertAuditLog,
  insertLeaveGrant,
  listActiveLeaveRequestsForDate,
  listAllApprovedLeaveRequests,
  listConvertedFromGrantIds,
  listGrantedOnDates,
  listLeaveGrants,
  listLeaveRequests,
  saveClosingSnapshots,
  createLeaveRequest,
  getLeaveRequest,
  updateLeaveRequestStatus,
  type Database,
  type LeaveGrant,
  type LeaveRequest,
  type LeaveRequestStatus,
} from "@kizami/db";
import {
  addMonths,
  addYears,
  allocateLeaveUsages,
  calculateBalance,
  calculateStatutoryGrants,
  calculateStockConversions,
  checkMandatoryFiveDays,
  resolveUsageMinutes,
  type GrantMethod,
  type LeaveGrantInput,
  type LeaveType,
  type LeaveUnit,
  type LeaveUsageInput,
} from "@kizami/leave";
import type { AppEnv } from "../auth/middleware.js";
import { ForbiddenError, requirePermission } from "../authz.js";
import { assertAmendAllowed } from "../lib/closing-guard.js";
import { computeMonthlyOutputForUser } from "../lib/closing-amend.js";
import { engineOutputFromSnapshots, snapshotInputsFromEngineOutput } from "../lib/closing-snapshot.js";
import { resolveAccessibleUserIds } from "../lib/scope.js";
import { buildSettingsTimeline, standardDayMinutesForDate, TZ_OFFSET_MINUTES_JST } from "../lib/settings.js";
import { nowMinutes, parseMonthParam, todayLocalDate } from "../lib/time.js";

const BALANCE_VIEW_PERMISSION = "leave.balance.view";
const GRANT_MANAGE_PERMISSION = "leave.grant.manage";
const MAX_REASON_LENGTH = 500;

/** pending 以外からの承認操作を、行が見つからなかった場合と区別するための内部シグナル(routes/corrections.ts と同じ形)。 */
class NotPendingConflictError extends Error {}
/** stocked 付与で「無期限」を表す番兵日付(leave_grants.expires_on は NOT NULL のため)。 */
const STOCK_NO_EXPIRY_DATE = "9999-12-31";

const VALID_UNITS: readonly LeaveUnit[] = ["full_day", "half_day_am", "half_day_pm", "hourly"];
const VALID_LEAVE_TYPES: readonly LeaveType[] = ["annual", "stocked"];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** テナントが有給設定を未保存の場合のデフォルト(スキーマの default 値と一致させる)。 */
const DEFAULT_LEAVE_SETTINGS = {
  grantMethod: "statutory" as GrantMethod,
  fixedDateMmDd: null as string | null,
  hourlyLeaveEnabled: false,
  hourlyLeaveMaxDays: 5,
  halfDayLeaveEnabled: true,
  stockConversionEnabled: false,
  stockMaxDays: 40,
  stockExpiresMonths: null as number | null,
};

type ResolvedLeaveSettings = typeof DEFAULT_LEAVE_SETTINGS;

async function loadLeaveSettings(db: Database, tenantId: string): Promise<ResolvedLeaveSettings> {
  const row = await getTenantLeaveSettings(db, tenantId);
  if (!row) return DEFAULT_LEAVE_SETTINGS;
  return {
    grantMethod: row.grantMethod as GrantMethod,
    fixedDateMmDd: row.fixedDateMmDd,
    hourlyLeaveEnabled: row.hourlyLeaveEnabled,
    hourlyLeaveMaxDays: row.hourlyLeaveMaxDays,
    halfDayLeaveEnabled: row.halfDayLeaveEnabled,
    stockConversionEnabled: row.stockConversionEnabled,
    stockMaxDays: row.stockMaxDays,
    stockExpiresMonths: row.stockExpiresMonths,
  };
}

function toGrantInputs(rows: LeaveGrant[]): LeaveGrantInput[] {
  return rows.map((g) => ({ id: g.id, leaveType: g.leaveType as LeaveType, grantedOn: g.grantedOn, days: g.days, expiresOn: g.expiresOn }));
}

/** 残高・年5日・上限判定に必要な文脈をまとめて組み立てる。extraDates は追加で分数解決が必要な日付(申請対象日など)。 */
interface BalanceContext {
  grants: LeaveGrantInput[];
  approvedUsages: LeaveUsageInput[];
  settings: ResolvedLeaveSettings;
  currentStandardDayMinutes: number;
  standardMinutesForDate: (date: string) => number;
  today: string;
}

async function loadBalanceContext(db: Database, tenantId: string, userId: string, extraDates: string[] = []): Promise<BalanceContext> {
  const [grantRows, approvedRequests, settings] = await Promise.all([
    listLeaveGrants(db, { tenantId, userId }),
    listAllApprovedLeaveRequests(db, { tenantId, userId }),
    loadLeaveSettings(db, tenantId),
  ]);

  const today = todayLocalDate(TZ_OFFSET_MINUTES_JST);
  const dates = [...new Set([...approvedRequests.map((r) => r.leaveDate), ...extraDates, today])].sort();
  const fromDate = dates[0] as string;
  const toDate = dates[dates.length - 1] as string;
  const timeline = await buildSettingsTimeline(db, { tenantId, userId, fromDate, toDate });
  const standardMinutesForDate = (date: string) => standardDayMinutesForDate(timeline, date);
  const currentStandardDayMinutes = standardMinutesForDate(today);

  const grants = toGrantInputs(grantRows);
  const approvedUsages: LeaveUsageInput[] = approvedRequests.map((r) => ({
    id: r.id,
    date: r.leaveDate,
    unit: r.unit as LeaveUnit,
    minutes: resolveUsageMinutes(r.unit as LeaveUnit, standardMinutesForDate(r.leaveDate), r.minutes ?? undefined),
    leaveType: r.leaveType as LeaveType,
  }));

  return { grants, approvedUsages, settings, currentStandardDayMinutes, standardMinutesForDate, today };
}

function serializeLeaveRequest(row: LeaveRequest) {
  return {
    id: row.id,
    userId: row.userId,
    requestedBy: row.requestedBy,
    status: row.status,
    leaveDate: row.leaveDate,
    unit: row.unit,
    minutes: row.minutes,
    leaveType: row.leaveType,
    reason: row.reason,
    decidedBy: row.decidedBy,
    decidedAt: row.decidedAt,
    decisionNote: row.decisionNote,
    createdAt: row.createdAt,
  };
}

function serializeLeaveGrant(row: LeaveGrant) {
  return {
    id: row.id,
    userId: row.userId,
    leaveType: row.leaveType,
    grantedOn: row.grantedOn,
    days: row.days,
    expiresOn: row.expiresOn,
    source: row.source,
    convertedFromGrantId: row.convertedFromGrantId,
    note: row.note,
    createdAt: row.createdAt,
  };
}

async function parseJsonBody(c: { req: { json: () => Promise<unknown> } }): Promise<Record<string, unknown> | null> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return {};
  }
  if (typeof body !== "object" || body === null) return null;
  return body as Record<string, unknown>;
}

function isValidReason(value: unknown): value is string {
  return typeof value === "string" && value.length >= 1 && value.length <= MAX_REASON_LENGTH;
}

/**
 * 同日の重複申請チェック(2026-08-22 仕様: 全休/半休/時間単位で衝突ルールが異なる)。
 * - 全休が既にあれば何も追加できない。全休を新規申請する場合も既存があれば不可
 * - 半休(am/pm)は「同じ unit」のみ重複扱い(午前+午後は共存できる)
 * - 時間単位は複数件を許容するが、その日の時間単位合計が所定労働時間を超えたら不可
 */
function detectRequestConflict(
  existing: LeaveRequest[],
  newUnit: LeaveUnit,
  newMinutes: number,
  dailyCapMinutes: number,
): "duplicate_request" | "exceeds_daily_hours" | null {
  if (existing.some((r) => r.unit === "full_day")) return "duplicate_request";
  if (newUnit === "full_day" && existing.length > 0) return "duplicate_request";
  if (newUnit === "half_day_am" || newUnit === "half_day_pm") {
    return existing.some((r) => r.unit === newUnit) ? "duplicate_request" : null;
  }
  if (newUnit === "hourly") {
    const existingHourlyMinutes = existing.filter((r) => r.unit === "hourly").reduce((sum, r) => sum + (r.minutes ?? 0), 0);
    return existingHourlyMinutes + newMinutes > dailyCapMinutes ? "exceeds_daily_hours" : null;
  }
  return null;
}

export function createLeaveRoutes(db: Database) {
  const app = new Hono<AppEnv>();

  // ---- GET /leave/balance ----
  app.get("/balance", async (c) => {
    const actor = c.get("user");
    const queryUserId = c.req.query("userId");

    let targetUserId = actor.id;
    if (queryUserId !== undefined && queryUserId !== actor.id) {
      requirePermission(c, BALANCE_VIEW_PERMISSION, "department");
      const accessible = await resolveAccessibleUserIds(db, {
        actor: { id: actor.id, tenantId: actor.tenantId, permissions: c.get("permissions") },
        permission: BALANCE_VIEW_PERMISSION,
      });
      if (accessible !== "all" && !accessible.has(queryUserId)) {
        throw new ForbiddenError(`target user ${queryUserId} is outside actor's scope`);
      }
      const target = await getUserById(db, { tenantId: actor.tenantId, id: queryUserId });
      if (!target) return c.json({ error: "not_found" }, 404);
      targetUserId = queryUserId;
    }

    const ctx = await loadBalanceContext(db, actor.tenantId, targetUserId);
    const balance = calculateBalance(ctx.grants, ctx.approvedUsages, {
      standardDayMinutes: ctx.currentStandardDayMinutes,
      hourlyLeaveMaxDays: ctx.settings.hourlyLeaveMaxDays,
      asOf: ctx.today,
    });
    const mandatoryFiveDays = checkMandatoryFiveDays(ctx.grants, ctx.approvedUsages, ctx.today);

    return c.json({
      standardDayMinutes: balance.standardDayMinutes,
      annual: balance.annual,
      stocked: balance.stocked,
      mandatoryFiveDays,
    });
  });

  // ---- GET /leave/requests ----
  app.get("/requests", async (c) => {
    const user = c.get("user");

    const statusParam = c.req.query("status") ?? "pending";
    let status: LeaveRequestStatus | undefined;
    if (statusParam === "pending") {
      status = "pending";
    } else if (statusParam === "all") {
      status = undefined;
    } else {
      return c.json({ error: "invalid_status" }, 400);
    }

    const requests = await listLeaveRequests(db, {
      tenantId: user.tenantId,
      userId: user.id,
      ...(status !== undefined ? { status } : {}),
    });
    return c.json({ requests: requests.map(serializeLeaveRequest) });
  });

  // ---- POST /leave/requests ----
  app.post("/requests", async (c) => {
    const user = c.get("user");

    const body = await parseJsonBody(c);
    if (body === null) return c.json({ error: "invalid_body" }, 400);

    const { leaveDate, reason } = body as { leaveDate?: unknown; reason?: unknown };
    if (typeof leaveDate !== "string" || !DATE_RE.test(leaveDate)) {
      return c.json({ error: "invalid_leave_date" }, 400);
    }
    if (!isValidReason(reason)) {
      return c.json({ error: "invalid_reason" }, 400);
    }

    const rawUnit = body.unit ?? "full_day";
    if (typeof rawUnit !== "string" || !VALID_UNITS.includes(rawUnit as LeaveUnit)) {
      return c.json({ error: "invalid_unit" }, 400);
    }
    const unit = rawUnit as LeaveUnit;

    const rawLeaveType = body.leaveType ?? "annual";
    if (typeof rawLeaveType !== "string" || !VALID_LEAVE_TYPES.includes(rawLeaveType as LeaveType)) {
      return c.json({ error: "invalid_leave_type" }, 400);
    }
    const leaveType = rawLeaveType as LeaveType;

    const settings = await loadLeaveSettings(db, user.tenantId);

    let explicitMinutes: number | undefined;
    if (unit === "hourly") {
      if (!settings.hourlyLeaveEnabled) return c.json({ error: "hourly_leave_disabled" }, 400);
      if (typeof body.minutes !== "number" || !Number.isInteger(body.minutes) || body.minutes <= 0) {
        return c.json({ error: "invalid_minutes" }, 400);
      }
      explicitMinutes = body.minutes;
    } else {
      if (body.minutes !== undefined) return c.json({ error: "invalid_body" }, 400);
      if ((unit === "half_day_am" || unit === "half_day_pm") && !settings.halfDayLeaveEnabled) {
        return c.json({ error: "half_day_leave_disabled" }, 400);
      }
    }

    const existing = await listActiveLeaveRequestsForDate(db, { tenantId: user.tenantId, userId: user.id, leaveDate });

    const ctx = await loadBalanceContext(db, user.tenantId, user.id, [leaveDate]);
    const candidateMinutes = resolveUsageMinutes(unit, ctx.standardMinutesForDate(leaveDate), explicitMinutes);

    const conflict = detectRequestConflict(existing, unit, candidateMinutes, ctx.standardMinutesForDate(leaveDate));
    if (conflict) return c.json({ error: conflict }, 409);

    const candidate: LeaveUsageInput = { id: "__candidate__", date: leaveDate, unit, minutes: candidateMinutes, leaveType };
    const allocation = allocateLeaveUsages(ctx.grants, [...ctx.approvedUsages, candidate], {
      standardDayMinutes: ctx.currentStandardDayMinutes,
      hourlyLeaveMaxDays: ctx.settings.hourlyLeaveMaxDays,
      asOf: ctx.today,
    });
    const candidateResult = allocation.usages.find((u) => u.usageId === "__candidate__");
    if (!candidateResult || candidateResult.grantId === null) {
      const errorCode = candidateResult?.reason === "hourly_limit_exceeded" ? "hourly_limit_exceeded" : "insufficient_balance";
      return c.json({ error: errorCode }, 409);
    }

    const created = await createLeaveRequest(db, {
      tenantId: user.tenantId,
      userId: user.id,
      requestedBy: user.id,
      leaveDate,
      unit,
      minutes: unit === "hourly" ? (explicitMinutes ?? null) : null,
      leaveType,
      reason,
      createdAt: nowMinutes(),
    });

    // 締め後修正(amend): 申請自体は締め済み月でも作成できる。leaveDate の属する月が
    // 締め済みなら targetMonthClosed=true を返し、UI が警告を出せるようにする
    // (承認時にのみ closing.unlock を要求する — POST /requests/:id/approve 参照)。
    const targetPeriod = leaveDate.slice(0, 7);
    const targetPeriodState = await getClosingState(db, { tenantId: user.tenantId, period: targetPeriod });

    return c.json({ request: serializeLeaveRequest(created), targetMonthClosed: targetPeriodState.status === "closed" }, 201);
  });

  // ---- POST /leave/requests/:id/approve ----
  app.post("/requests/:id/approve", async (c) => {
    const user = c.get("user");
    const body = await parseJsonBody(c);
    if (body === null || (body.note !== undefined && typeof body.note !== "string")) {
      return c.json({ error: "invalid_body" }, 400);
    }
    const note = (body.note as string | undefined) ?? null;

    const id = c.req.param("id");
    const existing = await getLeaveRequest(db, id);
    if (!existing || existing.tenantId !== user.tenantId) {
      return c.json({ error: "not_found" }, 404);
    }
    // v0.2 と同じ暫定運用: 自分が提出した申請のみ承認できる(他人の申請の承認はスコープ外)
    if (existing.requestedBy !== user.id) {
      throw new ForbiddenError("cannot approve another user's leave request");
    }
    if (existing.status !== "pending") {
      return c.json({ error: "not_pending" }, 409);
    }

    // 承認直前に再度残高を検証する(pending の間に他の申請が承認され残高が変わっている可能性があるため)。
    const ctx = await loadBalanceContext(db, user.tenantId, existing.userId, [existing.leaveDate]);
    const candidateMinutes = resolveUsageMinutes(
      existing.unit as LeaveUnit,
      ctx.standardMinutesForDate(existing.leaveDate),
      existing.minutes ?? undefined,
    );
    const candidate: LeaveUsageInput = {
      id: "__candidate__",
      date: existing.leaveDate,
      unit: existing.unit as LeaveUnit,
      minutes: candidateMinutes,
      leaveType: existing.leaveType as LeaveType,
    };
    const allocation = allocateLeaveUsages(ctx.grants, [...ctx.approvedUsages, candidate], {
      standardDayMinutes: ctx.currentStandardDayMinutes,
      hourlyLeaveMaxDays: ctx.settings.hourlyLeaveMaxDays,
      asOf: ctx.today,
    });
    const candidateResult = allocation.usages.find((u) => u.usageId === "__candidate__");
    if (!candidateResult || candidateResult.grantId === null) {
      const errorCode = candidateResult?.reason === "hourly_limit_exceeded" ? "hourly_limit_exceeded" : "insufficient_balance";
      return c.json({ error: errorCode }, 409);
    }

    const now = nowMinutes();
    const selfApproved = existing.requestedBy === user.id;
    const period = existing.leaveDate.slice(0, 7);
    const parsedMonth = parseMonthParam(period);
    if (!parsedMonth) {
      throw new Error(`leave_request ${existing.id} has an unparsable leaveDate: ${existing.leaveDate}`);
    }

    const permissions = c.get("permissions");

    // 締め後修正(amend): 対象日が締め済み月なら closing.unlock を持つ場合のみ承認できる。
    // 反映(status 更新)・監査ログ・(必要なら)スナップショット再計算・amend 追記を
    // 同一トランザクションで行う(routes/corrections.ts の POST /:id/approve と同じ形)。
    let result: { updated: LeaveRequest; amended: boolean };
    try {
      result = await db.transaction(async (tx) => {
        const wasClosed = await assertAmendAllowed(tx, { tenantId: user.tenantId, period, permissions });

        const updatedRow = await updateLeaveRequestStatus(tx, {
          id: existing.id,
          tenantId: user.tenantId,
          fromStatus: "pending",
          status: "approved",
          decidedBy: user.id,
          decidedAt: now,
          decisionNote: note,
        });
        if (!updatedRow) {
          throw new NotPendingConflictError();
        }

        await insertAuditLog(tx, {
          tenantId: user.tenantId,
          actorId: user.id,
          action: "leave_request.approve",
          targetType: "leave_request",
          targetId: existing.id,
          detail: JSON.stringify({
            selfApproved,
            leaveDate: existing.leaveDate,
            unit: existing.unit,
            leaveType: existing.leaveType,
            amended: wasClosed,
          }),
          occurredAt: now,
        });

        if (wasClosed) {
          const beforeSnapshots = (await getClosingSnapshots(tx, { tenantId: user.tenantId, period })).filter(
            (s) => s.userId === existing.userId,
          );
          const before = engineOutputFromSnapshots(beforeSnapshots);

          const output = await computeMonthlyOutputForUser(tx, {
            tenantId: user.tenantId,
            userId: existing.userId,
            year: parsedMonth.year,
            month: parsedMonth.month,
          });

          const amendEvent = await appendClosingEvent(tx, {
            tenantId: user.tenantId,
            period,
            event: "amend",
            actorId: user.id,
            note: null,
            leaveRequestId: existing.id,
            occurredAt: now,
          });

          await saveClosingSnapshots(
            tx,
            snapshotInputsFromEngineOutput({
              tenantId: user.tenantId,
              closingEventId: amendEvent.id,
              userId: existing.userId,
              totals: output.totals,
              flexBalance: output.flexBalance,
            }),
          );

          await insertAuditLog(tx, {
            tenantId: user.tenantId,
            actorId: user.id,
            action: "closing.amend",
            targetType: "closing",
            targetId: period,
            detail: JSON.stringify({
              period,
              leaveRequestId: existing.id,
              before,
              after: { totals: output.totals, flexBalance: output.flexBalance },
            }),
            occurredAt: now,
          });
        }

        return { updated: updatedRow, amended: wasClosed };
      });
    } catch (err) {
      if (err instanceof NotPendingConflictError) {
        return c.json({ error: "not_pending" }, 409);
      }
      throw err;
    }

    return c.json({ request: serializeLeaveRequest(result.updated), amended: result.amended }, 200);
  });

  // ---- POST /leave/requests/:id/reject ----
  app.post("/requests/:id/reject", async (c) => {
    const user = c.get("user");
    const body = await parseJsonBody(c);
    if (body === null || (body.note !== undefined && typeof body.note !== "string")) {
      return c.json({ error: "invalid_body" }, 400);
    }
    const note = (body.note as string | undefined) ?? null;

    const id = c.req.param("id");
    const existing = await getLeaveRequest(db, id);
    if (!existing || existing.tenantId !== user.tenantId) {
      return c.json({ error: "not_found" }, 404);
    }
    if (existing.requestedBy !== user.id) {
      throw new ForbiddenError("cannot reject another user's leave request");
    }
    if (existing.status !== "pending") {
      return c.json({ error: "not_pending" }, 409);
    }

    const now = nowMinutes();
    const selfApproved = existing.requestedBy === user.id;

    const updated = await updateLeaveRequestStatus(db, {
      id: existing.id,
      tenantId: user.tenantId,
      fromStatus: "pending",
      status: "rejected",
      decidedBy: user.id,
      decidedAt: now,
      decisionNote: note,
    });
    if (!updated) return c.json({ error: "not_pending" }, 409);

    await insertAuditLog(db, {
      tenantId: user.tenantId,
      actorId: user.id,
      action: "leave_request.reject",
      targetType: "leave_request",
      targetId: existing.id,
      detail: JSON.stringify({ selfApproved }),
      occurredAt: now,
    });

    return c.json({ request: serializeLeaveRequest(updated) }, 200);
  });

  // ---- POST /leave/requests/:id/withdraw ----
  app.post("/requests/:id/withdraw", async (c) => {
    const user = c.get("user");
    const id = c.req.param("id");
    const existing = await getLeaveRequest(db, id);
    if (!existing || existing.tenantId !== user.tenantId) {
      return c.json({ error: "not_found" }, 404);
    }
    if (existing.requestedBy !== user.id) {
      throw new ForbiddenError("cannot withdraw another user's leave request");
    }
    if (existing.status !== "pending") {
      return c.json({ error: "not_pending" }, 409);
    }

    const updated = await updateLeaveRequestStatus(db, {
      id: existing.id,
      tenantId: user.tenantId,
      fromStatus: "pending",
      status: "withdrawn",
    });
    if (!updated) return c.json({ error: "not_pending" }, 409);

    return c.json({ request: serializeLeaveRequest(updated) }, 200);
  });

  // ---- POST /leave/grants(手動付与) ----
  app.post("/grants", async (c) => {
    requirePermission(c, GRANT_MANAGE_PERMISSION, "department_and_descendants");
    const actor = c.get("user");

    const body = await parseJsonBody(c);
    if (body === null) return c.json({ error: "invalid_body" }, 400);
    const { userId, grantedOn, days, expiresOn, leaveType, note } = body as {
      userId?: unknown;
      grantedOn?: unknown;
      days?: unknown;
      expiresOn?: unknown;
      leaveType?: unknown;
      note?: unknown;
    };

    if (typeof userId !== "string") return c.json({ error: "invalid_user_id" }, 400);
    if (typeof grantedOn !== "string" || !DATE_RE.test(grantedOn)) return c.json({ error: "invalid_granted_on" }, 400);
    if (typeof days !== "number" || !Number.isInteger(days) || days <= 0) return c.json({ error: "invalid_days" }, 400);
    const resolvedLeaveType = (leaveType ?? "annual") as unknown;
    if (typeof resolvedLeaveType !== "string" || !VALID_LEAVE_TYPES.includes(resolvedLeaveType as LeaveType)) {
      return c.json({ error: "invalid_leave_type" }, 400);
    }
    if (note !== undefined && typeof note !== "string") return c.json({ error: "invalid_note" }, 400);

    let resolvedExpiresOn: string;
    if (expiresOn !== undefined) {
      if (typeof expiresOn !== "string" || !DATE_RE.test(expiresOn)) return c.json({ error: "invalid_expires_on" }, 400);
      resolvedExpiresOn = expiresOn;
    } else if (resolvedLeaveType === "annual") {
      resolvedExpiresOn = addYears(grantedOn, 2);
    } else {
      resolvedExpiresOn = STOCK_NO_EXPIRY_DATE;
    }

    const target = await getUserById(db, { tenantId: actor.tenantId, id: userId });
    if (!target) return c.json({ error: "not_found" }, 404);

    const accessible = await resolveAccessibleUserIds(db, {
      actor: { id: actor.id, tenantId: actor.tenantId, permissions: c.get("permissions") },
      permission: GRANT_MANAGE_PERMISSION,
    });
    if (accessible !== "all" && !accessible.has(userId)) {
      throw new ForbiddenError(`target user ${userId} is outside actor's scope`);
    }

    const now = nowMinutes();
    const created = await insertLeaveGrant(db, {
      tenantId: actor.tenantId,
      userId,
      leaveType: resolvedLeaveType,
      grantedOn,
      days,
      expiresOn: resolvedExpiresOn,
      source: "manual",
      note: note ?? null,
      createdAt: now,
    });

    await insertAuditLog(db, {
      tenantId: actor.tenantId,
      actorId: actor.id,
      action: "leave_grant.manual_create",
      targetType: "leave_grant",
      targetId: created.id,
      detail: JSON.stringify({ userId, leaveType: resolvedLeaveType, grantedOn, days, expiresOn: resolvedExpiresOn }),
      occurredAt: now,
    });

    return c.json({ grant: serializeLeaveGrant(created) }, 201);
  });

  // ---- POST /leave/grants/auto(法定付与の自動計算・冪等) ----
  app.post("/grants/auto", async (c) => {
    requirePermission(c, GRANT_MANAGE_PERMISSION, "department_and_descendants");
    const actor = c.get("user");

    const body = await parseJsonBody(c);
    if (body === null || typeof body.userId !== "string") return c.json({ error: "invalid_user_id" }, 400);
    const userId = body.userId;

    const target = await getUserById(db, { tenantId: actor.tenantId, id: userId });
    if (!target) return c.json({ error: "not_found" }, 404);
    if (!target.hireDate) return c.json({ error: "hire_date_not_set" }, 400);

    const accessible = await resolveAccessibleUserIds(db, {
      actor: { id: actor.id, tenantId: actor.tenantId, permissions: c.get("permissions") },
      permission: GRANT_MANAGE_PERMISSION,
    });
    if (accessible !== "all" && !accessible.has(userId)) {
      throw new ForbiddenError(`target user ${userId} is outside actor's scope`);
    }

    const settingsRow = await getTenantLeaveSettings(db, actor.tenantId);
    if (!settingsRow) return c.json({ error: "leave_settings_not_configured" }, 400);

    const today = todayLocalDate(TZ_OFFSET_MINUTES_JST);
    const calculated = calculateStatutoryGrants(
      target.hireDate,
      today,
      settingsRow.grantMethod as GrantMethod,
      settingsRow.fixedDateMmDd ?? undefined,
    );

    const existingDates = await listGrantedOnDates(db, { tenantId: actor.tenantId, userId });
    const toCreate = calculated.filter((g) => !existingDates.has(g.grantedOn));

    const now = nowMinutes();
    const created: LeaveGrant[] = [];
    for (const g of toCreate) {
      created.push(
        await insertLeaveGrant(db, {
          tenantId: actor.tenantId,
          userId,
          leaveType: g.leaveType,
          grantedOn: g.grantedOn,
          days: g.days,
          expiresOn: g.expiresOn,
          source: "auto",
          createdAt: now,
        }),
      );
    }

    await insertAuditLog(db, {
      tenantId: actor.tenantId,
      actorId: actor.id,
      action: "leave_grant.auto_create",
      targetType: "user",
      targetId: userId,
      detail: JSON.stringify({ createdGrantedOn: created.map((g) => g.grantedOn), skipped: calculated.length - toCreate.length }),
      occurredAt: now,
    });

    return c.json({ created: created.map(serializeLeaveGrant), skipped: calculated.length - toCreate.length }, 201);
  });

  // ---- POST /leave/grants/convert-expired(失効年休の積立振替) ----
  app.post("/grants/convert-expired", async (c) => {
    requirePermission(c, GRANT_MANAGE_PERMISSION, "department_and_descendants");
    const actor = c.get("user");

    const body = await parseJsonBody(c);
    if (body === null || typeof body.userId !== "string") return c.json({ error: "invalid_user_id" }, 400);
    const userId = body.userId;

    const target = await getUserById(db, { tenantId: actor.tenantId, id: userId });
    if (!target) return c.json({ error: "not_found" }, 404);

    const accessible = await resolveAccessibleUserIds(db, {
      actor: { id: actor.id, tenantId: actor.tenantId, permissions: c.get("permissions") },
      permission: GRANT_MANAGE_PERMISSION,
    });
    if (accessible !== "all" && !accessible.has(userId)) {
      throw new ForbiddenError(`target user ${userId} is outside actor's scope`);
    }

    const settings = await loadLeaveSettings(db, actor.tenantId);
    if (!settings.stockConversionEnabled) return c.json({ error: "stock_conversion_disabled" }, 400);

    const [ctx, alreadyConvertedGrantIds] = await Promise.all([
      loadBalanceContext(db, actor.tenantId, userId),
      listConvertedFromGrantIds(db, { tenantId: actor.tenantId, userId }),
    ]);

    const currentBalance = calculateBalance(ctx.grants, ctx.approvedUsages, {
      standardDayMinutes: ctx.currentStandardDayMinutes,
      hourlyLeaveMaxDays: ctx.settings.hourlyLeaveMaxDays,
      asOf: ctx.today,
    });
    const existingStockedDaysTotal = Math.floor(currentBalance.stocked.remainingMinutes / ctx.currentStandardDayMinutes);

    const conversions = calculateStockConversions(ctx.grants, ctx.approvedUsages, {
      standardDayMinutes: ctx.currentStandardDayMinutes,
      hourlyLeaveMaxDays: ctx.settings.hourlyLeaveMaxDays,
      asOf: ctx.today,
      alreadyConvertedGrantIds,
      stockMaxDays: settings.stockMaxDays,
      existingStockedDaysTotal,
    });

    const now = nowMinutes();
    const expiresOn =
      settings.stockExpiresMonths !== null ? addMonths(ctx.today, settings.stockExpiresMonths) : STOCK_NO_EXPIRY_DATE;

    const createdGrants: LeaveGrant[] = [];
    for (const conv of conversions) {
      createdGrants.push(
        await insertLeaveGrant(db, {
          tenantId: actor.tenantId,
          userId,
          leaveType: "stocked",
          grantedOn: ctx.today,
          days: conv.convertedDays,
          expiresOn,
          source: "conversion",
          convertedFromGrantId: conv.sourceGrantId,
          note: `失効分振替(失効時未消化${conv.leftoverDays}日${conv.truncatedDays > 0 ? `、上限により${conv.truncatedDays}日切り捨て` : ""})`,
          createdAt: now,
        }),
      );
    }

    await insertAuditLog(db, {
      tenantId: actor.tenantId,
      actorId: actor.id,
      action: "leave_grant.convert_expired",
      targetType: "user",
      targetId: userId,
      detail: JSON.stringify({ conversions }),
      occurredAt: now,
    });

    return c.json({ conversions, created: createdGrants.map(serializeLeaveGrant) }, 201);
  });

  return app;
}
