/**
 * GET /leave/balance, GET /leave/requests, POST /leave/requests,
 * POST /leave/requests/:id/{approve,reject,withdraw}, POST /leave/grants,
 * POST /leave/grants/auto, POST /leave/grants/convert-expired,
 * GET /leave/grant-proposals, POST /leave/grant-proposals/:id/{approve,reject}
 *
 * 有給付与の3段フロー(予告 → 管理者承認 → 本人通知、docs/requirements.md §11 /
 * docs/design/shift-work.md 実装フェーズ4、2026-08-24 追加): 1段目の予告作成は日次ワーカー
 * (apps/api/src/leave-grant-proposals.ts)、2段目の承認・却下と3段目の本人通知が本ファイルの
 * /grant-proposals 系エンドポイント。機械が無条件に付与を確定させないための構造であり、
 * 出勤率(労基法39条1項の8割要件)の最終判断は人が行う。
 *
 * 有給休暇管理(docs/requirements.md §5)。休暇申請→承認フローは routes/corrections.ts
 * (打刻修正申請)と同じ形を踏襲する: 申請→pending→承認/却下/取下げ、承認時に監査ログ
 * (自己承認は selfApproved)。申請の作成(POST /requests)・取下げ(withdraw)は本人のみ
 * (代理申請は対象外)。
 *
 * 承認(approve/reject)の認可(2026-08-23 改定): 権限カタログに元々定義されていた
 * `leave.request.approve` + apps/api/src/lib/scope.ts の resolveAccessibleUserIds による
 * スコープ判定を使う権限ベース方式へ統一する(routes/auto-break-waivers.ts・
 * routes/corrections.ts と同じ形)。本人が自分の申請を承認することも引き続き可能だが、
 * それには `leave.request.approve` 権限そのものを持っている必要がある。GET /requests の
 * スコープも同様に統一する: `leave.request.view_all`(`leave.request.approve` が含意展開で
 * 自動的に含む)を持たなければ自分の分だけ、持てば `?userId=` 指定 or スコープ内全員を返す。
 * 残高閲覧(GET /leave/balance?userId=)と付与管理(POST /leave/grants*)は元々権限プリセット
 * 方式(requirePermission + resolveAccessibleUserIds)のまま変更しない。
 *
 * 承認・却下時の本人通知(2026-08-23 追加): 決裁者が申請者本人と異なる場合のみ、
 * apps/api/src/lib/notification-channels.ts の buildPersonalChannels 経由で本人へ通知する
 * (routes/auto-break-waivers.ts の POST /:id/approve と同じ形。waiver は approve のみ通知
 * するが、このファイルは依頼により approve・reject の両方で通知する。通知種別は
 * "leave_request_*" とし、apps/api/src/lib/notification-preferences.ts の既存の "leave_"
 * プレフィックス一致でカテゴリ leave_alert に自動分類される — routes/corrections.ts の
 * correction_alert とは異なるカテゴリを敢えて使う。休暇関連の通知は元々 leave_alert に
 * 束ねられており〔失効間近・年5日義務〕、承認・却下もその同じ「休暇のお知らせ」として
 * 個人設定で一括ON/OFFできる方が自然と判断した)。
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
 *
 * 承認依頼の通知(2026-08-23 追加): POST /requests で申請が作成されたら、
 * apps/api/src/lib/approvers.ts の resolveApproversForUser で承認者(申請者をスコープに含む
 * 形で APPROVE_PERMISSION を持つ人)を解決し、申請者自身を除いて通知する(routes/corrections.ts
 * の POST / と同じ形。詳細な設計理由・テナント共有 Webhook の扱いは routes/corrections.ts の
 * ヘッダコメント参照)。
 */

import { Hono } from "hono";
import {
  appendClosingEvent,
  createNotificationIfAbsent,
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
  getLeaveGrantProposal,
  getLeaveRequest,
  listLeaveGrantProposals,
  listTenantUsers,
  supersedeProposedLeaveGrantProposals,
  updateLeaveGrantProposalStatus,
  updateLeaveRequestStatus,
  type Database,
  type LeaveGrant,
  type LeaveGrantProposal,
  type LeaveGrantProposalStatus,
  type LeaveRequest,
  type LeaveRequestStatus,
} from "@kizami/db";
import { dispatch } from "@kizami/notify";
import {
  addMonths,
  addYears,
  allocateLeaveUsages,
  calculateBalance,
  calculateStatutoryGrants,
  calculateStockConversions,
  checkMandatoryFiveDays,
  isLeaveGrantClass,
  resolveUsageMinutes,
  type AttendanceRateReference,
  type GrantMethod,
  type LeaveGrantClass,
  type LeaveGrantInput,
  type LeaveType,
  type LeaveUnit,
  type LeaveUsageInput,
} from "@kizami/leave";
import type { AppEnv } from "../auth/middleware.js";
import { ForbiddenError, requirePermission } from "../authz.js";
import { resolveApproversForUser } from "../lib/approvers.js";
import { assertAmendAllowed } from "../lib/closing-guard.js";
import { computeMonthlyOutputForUser } from "../lib/closing-amend.js";
import { engineOutputFromSnapshots, snapshotInputsFromEngineOutput, sumFixedBreakdown } from "../lib/closing-snapshot.js";
import { buildPersonalChannels, buildTenantChannels, type BuildPersonalChannelsOptions } from "../lib/notification-channels.js";
import { resolveAccessibleUserIds } from "../lib/scope.js";
import { makeLeaveStandardMinutesResolver } from "../lib/leave-minutes.js";
import { buildSettingsTimelineWithBaseDayMinutes, TZ_OFFSET_MINUTES_JST } from "../lib/settings.js";
import { nowMinutes, parseMonthParam, todayLocalDate } from "../lib/time.js";

const BALANCE_VIEW_PERMISSION = "leave.balance.view";
const GRANT_MANAGE_PERMISSION = "leave.grant.manage";
/** 承認・却下の両方が要求する権限(routes/corrections.ts・routes/auto-break-waivers.ts と同じ判断点)。 */
const APPROVE_PERMISSION = "leave.request.approve";
/** 一覧で他者分を見るための権限。APPROVE_PERMISSION が含意展開で自動的に含む
 * (packages/authz/src/implied.ts)ため、承認権限だけを持つ人も一覧は見える。 */
const VIEW_ALL_PERMISSION = "leave.request.view_all";
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

/**
 * users.leave_grant_class(TEXT)を LeaveGrantClass へ解決する。想定外の値は "full" に倒す
 * — 区分の取り違えは「法定より少なく付与する」方向の事故になり得るため、不明なら常に
 * 最も日数の多い通常付与を選ぶ(packages/leave/src/statutory.ts の判断点と同じ)。
 */
function resolveLeaveGrantClass(value: string | null | undefined): LeaveGrantClass {
  return isLeaveGrantClass(value) ? value : "full";
}

function toGrantInputs(rows: LeaveGrant[]): LeaveGrantInput[] {
  return rows.map((g) => ({ id: g.id, leaveType: g.leaveType as LeaveType, grantedOn: g.grantedOn, days: g.days, expiresOn: g.expiresOn }));
}

/**
 * 残高・年5日・上限判定に必要な文脈をまとめて組み立てる。extraDates は追加で分数解決が必要な日付(申請対象日など)。
 *
 * apps/api/src/leave-alerts.ts からも再利用する(失効間近・年5日義務アラートの残高計算は
 * この GET /leave/balance と完全に同一の組み立てであるべきで、二重管理しない)。
 */
export interface BalanceContext {
  grants: LeaveGrantInput[];
  approvedUsages: LeaveUsageInput[];
  settings: ResolvedLeaveSettings;
  currentStandardDayMinutes: number;
  standardMinutesForDate: (date: string) => number;
  today: string;
}

export async function loadBalanceContext(db: Database, tenantId: string, userId: string, extraDates: string[] = []): Promise<BalanceContext> {
  const [grantRows, approvedRequests, settings] = await Promise.all([
    listLeaveGrants(db, { tenantId, userId }),
    listAllApprovedLeaveRequests(db, { tenantId, userId }),
    loadLeaveSettings(db, tenantId),
  ]);

  const today = todayLocalDate(TZ_OFFSET_MINUTES_JST);
  const dates = [...new Set([...approvedRequests.map((r) => r.leaveDate), ...extraDates, today])].sort();
  const fromDate = dates[0] as string;
  const toDate = dates[dates.length - 1] as string;
  const { timeline, baseDayMinutes } = await buildSettingsTimelineWithBaseDayMinutes(db, { tenantId, userId, fromDate, toDate });
  // シフト制(monthly_variable)の1日分の所定は日付ごとに変わる(シフトがある日はその所定、
  // 無い日は基準所定)。解決に DB が要るため非同期のリゾルバを1度だけ組み立て、以後は同期に引く
  // (apps/api/src/lib/leave-minutes.ts)。flex/fixed では従来と同一の値・同一のクエリ数。
  const leaveMinutes = await makeLeaveStandardMinutesResolver(db, { tenantId, userId, timeline, baseDayMinutes, fromDate, toDate });
  const standardMinutesForDate = (date: string) => leaveMinutes.forDate(date);
  // 残高の日↔分換算は「基準所定」だけを使う(その日のシフトの長短で残日数の見え方が
  // 変わらないようにするため — leave-minutes.ts の冒頭コメント参照)。
  const currentStandardDayMinutes = leaveMinutes.baseForDate(today);

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

const VALID_PROPOSAL_STATUSES: readonly LeaveGrantProposalStatus[] = ["proposed", "approved", "rejected", "superseded"];

/**
 * 予告1件のレスポンス形。`attendanceRate` は保存時の JSON をそのままオブジェクトへ戻す
 * (再計算しない — 承認画面で見た数字と監査上の記録を一致させるため、
 * packages/db/src/schema/leave.ts のコメント参照)。
 */
function serializeLeaveGrantProposal(row: LeaveGrantProposal, userName: string | null, leaveGrantClass: LeaveGrantClass | null = null) {
  return {
    id: row.id,
    userId: row.userId,
    userName,
    /**
     * 予告作成時点ではなく「現在の」対象者の付与区分(users.leave_grant_class)。
     * 予告一覧で「なぜ日数がフルタイムの表と違うのか」を管理者が読み取れるようにするための
     * 表示用の値であり、日数そのものは予告行(days)が正。解決できない場合は null。
     */
    leaveGrantClass,
    leaveType: row.leaveType,
    grantedOn: row.grantedOn,
    days: row.days,
    expiresOn: row.expiresOn,
    attendanceRate: JSON.parse(row.attendanceRate) as AttendanceRateReference,
    status: row.status,
    proposedAt: row.proposedAt,
    decidedBy: row.decidedBy,
    decidedAt: row.decidedAt,
    decisionNote: row.decisionNote,
    grantId: row.grantId,
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

export type LeaveRoutesDeps = BuildPersonalChannelsOptions;

export function createLeaveRoutes(db: Database, deps: LeaveRoutesDeps = {}) {
  const app = new Hono<AppEnv>();

  // ---- GET /leave/balance ----
  /**
   * 自分が休暇申請するときに必要な情報だけを返す(認証だけで読める)。
   *
   * GET /settings/leave は leave.grant.manage(テナント)権限が要るため、一般の従業員は
   * 自社が時間単位年休や半休を有効にしているかを知る手段が無く、申請フォームが誤った
   * 選択肢を出してしまっていた(2026-08-22 修正)。制度の可否と所定労働時間は
   * 従業員本人が自分の申請のために知るべき情報なので、秘密情報を含まない形で公開する。
   */
  app.get("/capabilities", async (c) => {
    const actor = c.get("user");
    const settings = await loadLeaveSettings(db, actor.tenantId);
    const ctx = await loadBalanceContext(db, actor.tenantId, actor.id);
    return c.json({
      hourlyLeaveEnabled: settings.hourlyLeaveEnabled,
      hourlyLeaveMaxDays: settings.hourlyLeaveMaxDays,
      halfDayLeaveEnabled: settings.halfDayLeaveEnabled,
      stockConversionEnabled: settings.stockConversionEnabled,
      standardDayMinutes: ctx.currentStandardDayMinutes,
    });
  });

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
  // 既定は自分の一覧。?userId= で他者を明示指定した場合、または VIEW_ALL_PERMISSION
  // (承認権限からの含意展開を含む)を持つ場合はスコープ内の他者分も返す
  // (routes/auto-break-waivers.ts・routes/corrections.ts の GET / と同じ形)。
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

    const permissions = c.get("permissions");
    const queryUserId = c.req.query("userId");

    let requests: LeaveRequest[];
    if (queryUserId !== undefined && queryUserId !== user.id) {
      const accessible = await resolveAccessibleUserIds(db, {
        actor: { id: user.id, tenantId: user.tenantId, permissions },
        permission: VIEW_ALL_PERMISSION,
      });
      if (accessible !== "all" && !accessible.has(queryUserId)) {
        throw new ForbiddenError(`target user ${queryUserId} is outside actor's scope`);
      }
      // 自テナントに実在するユーザーであることを確認する(2026-08-24 マルチテナント有効化)。
      // 他テナントのユーザーIDに 200(空配列)を返さないため。GET /leave/balance と同じ 404 に揃える。
      const target = await getUserById(db, { tenantId: user.tenantId, id: queryUserId });
      if (!target) return c.json({ error: "not_found" }, 404);
      requests = await listLeaveRequests(db, {
        tenantId: user.tenantId,
        userId: queryUserId,
        ...(status !== undefined ? { status } : {}),
      });
    } else if (permissions.get(VIEW_ALL_PERMISSION) === undefined) {
      // userId 未指定: VIEW_ALL_PERMISSION を持たなければ自分の分だけ。
      requests = await listLeaveRequests(db, {
        tenantId: user.tenantId,
        userId: user.id,
        ...(status !== undefined ? { status } : {}),
      });
    } else {
      // queries/leave.ts の listLeaveRequests は複数ユーザーIDの一括絞り込みを持たないため、
      // tenantId のみで取得しアプリ層でスコープ内に絞り込む(apps/api/src/lib/scope.ts と
      // 同じ「テナントあたり小規模」の前提)。
      const accessible = await resolveAccessibleUserIds(db, {
        actor: { id: user.id, tenantId: user.tenantId, permissions },
        permission: VIEW_ALL_PERMISSION,
      });
      const all = await listLeaveRequests(db, {
        tenantId: user.tenantId,
        ...(status !== undefined ? { status } : {}),
      });
      requests = accessible === "all" ? all : all.filter((r) => accessible.has(r.userId));
    }

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

    // 承認依頼の通知(routes/corrections.ts の POST / と同じ形。詳細な設計理由は
    // routes/corrections.ts のヘッダコメント参照)。申請者自身が承認権限を持つ場合でも、
    // 自分の申請の通知は自分には送らない。
    const approverIds = (
      await resolveApproversForUser(db, { tenantId: user.tenantId, subjectUserId: user.id, permission: APPROVE_PERMISSION })
    ).filter((id) => id !== user.id);

    const notificationType = "approval_request_leave";
    const title = "承認待ちの休暇申請があります";
    const notificationBody = `${user.displayName}さんから休暇申請が届きました。確認してください。`;

    for (const approverId of approverIds) {
      const notification = await createNotificationIfAbsent(db, {
        tenantId: user.tenantId,
        userId: approverId,
        type: notificationType,
        subjectDate: null,
        title,
        body: notificationBody,
        createdAt: created.createdAt,
      });
      if (notification) {
        const channels = await buildPersonalChannels(db, { tenantId: user.tenantId, userId: approverId, notificationType }, deps);
        if (channels.length > 0) {
          await dispatch(channels, { to: {}, title, body: notificationBody });
        }
      }
    }

    // テナント共有 Webhook にも1件(routes/corrections.ts の POST / と同じ判断: 承認者が
    // 1人もいなくてもテナント側の共有チャネルが設定されていれば送る)。
    const tenantChannels = await buildTenantChannels(db, user.tenantId, deps);
    if (tenantChannels.length > 0) {
      await dispatch(tenantChannels, {
        to: {},
        title,
        body: `${user.displayName}さんから休暇申請が届きました。/leave/requests で確認してください。`,
      });
    }

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
    requirePermission(c, APPROVE_PERMISSION, "department");

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

    const permissions = c.get("permissions");
    const accessible = await resolveAccessibleUserIds(db, {
      actor: { id: user.id, tenantId: user.tenantId, permissions },
      permission: APPROVE_PERMISSION,
    });
    if (accessible !== "all" && !accessible.has(existing.userId)) {
      throw new ForbiddenError(`target user ${existing.userId} is outside actor's scope`);
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
              output,
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
              after: {
                totals: output.totals,
                flexBalance: output.flexBalance,
                fixedBreakdown: output.workSystem === "fixed" ? sumFixedBreakdown(output.days) : null,
              },
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

    // 本人へ通知(決裁者が申請者本人と異なる場合のみ。自己承認では自分に通知しない —
    // routes/auto-break-waivers.ts の POST /:id/approve と同じ判断。ただし waiver は
    // approve のみ通知するが、依頼によりこちらは approve・reject の両方で通知する)。
    if (!selfApproved) {
      const notificationType = "leave_request_approved";
      const title = "休暇申請が承認されました";
      const notificationBody = `${existing.leaveDate} の休暇申請が承認されました。`;
      const notification = await createNotificationIfAbsent(db, {
        tenantId: user.tenantId,
        userId: existing.userId,
        type: notificationType,
        // leaveDate は同日に複数件(午前/午後・時間単位の複数申請)が存在しうるため、
        // subject_date に leaveDate を使うと2件目以降の承認通知が UNIQUE 制約で
        // 無言で握りつぶされてしまう(routes/corrections.ts と同じ理由で null にする —
        // 承認は pending から一度しか遷移できないためこの選択でも重複作成の心配はない)。
        subjectDate: null,
        title,
        body: notificationBody,
        createdAt: now,
      });
      if (notification) {
        const channels = await buildPersonalChannels(
          db,
          { tenantId: user.tenantId, userId: existing.userId, notificationType },
          deps,
        );
        if (channels.length > 0) {
          await dispatch(channels, { to: {}, title, body: notificationBody });
        }
      }
    }

    return c.json({ request: serializeLeaveRequest(result.updated), amended: result.amended }, 200);
  });

  // ---- POST /leave/requests/:id/reject ----
  app.post("/requests/:id/reject", async (c) => {
    const user = c.get("user");
    requirePermission(c, APPROVE_PERMISSION, "department");

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

    const permissions = c.get("permissions");
    const accessible = await resolveAccessibleUserIds(db, {
      actor: { id: user.id, tenantId: user.tenantId, permissions },
      permission: APPROVE_PERMISSION,
    });
    if (accessible !== "all" && !accessible.has(existing.userId)) {
      throw new ForbiddenError(`target user ${existing.userId} is outside actor's scope`);
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

    if (!selfApproved) {
      const notificationType = "leave_request_rejected";
      const title = "休暇申請が却下されました";
      const notificationBody = note
        ? `${existing.leaveDate} の休暇申請が却下されました。コメント: ${note}`
        : `${existing.leaveDate} の休暇申請が却下されました。`;
      const notification = await createNotificationIfAbsent(db, {
        tenantId: user.tenantId,
        userId: existing.userId,
        type: notificationType,
        subjectDate: null,
        title,
        body: notificationBody,
        createdAt: now,
      });
      if (notification) {
        const channels = await buildPersonalChannels(
          db,
          { tenantId: user.tenantId, userId: existing.userId, notificationType },
          deps,
        );
        if (channels.length > 0) {
          await dispatch(channels, { to: {}, title, body: notificationBody });
        }
      }
    }

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
      // 比例付与の区分(労基法39条3項)。未設定・想定外の値は "full" に倒す
      // (少なく付与する方向へ倒さない、packages/leave/src/statutory.ts の判断点)。
      resolveLeaveGrantClass(target.leaveGrantClass),
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

    // 予告(leave_grant_proposals)を経由せずに同じ基準日の付与を作った場合、その予告は
    // もう決裁の余地が無いので superseded にする(依頼の決定。POST /grants/auto は
    // 「手動の一括経路」として残し、予告フローと二重に付与が生まれないようにする)。
    const supersededProposals = await supersedeProposedLeaveGrantProposals(db, {
      tenantId: actor.tenantId,
      userId,
      grantedOnDates: created.map((g) => g.grantedOn),
    });

    await insertAuditLog(db, {
      tenantId: actor.tenantId,
      actorId: actor.id,
      action: "leave_grant.auto_create",
      targetType: "user",
      targetId: userId,
      detail: JSON.stringify({
        createdGrantedOn: created.map((g) => g.grantedOn),
        skipped: calculated.length - toCreate.length,
        supersededProposalIds: supersededProposals.map((p) => p.id),
      }),
      occurredAt: now,
    });

    return c.json({ created: created.map(serializeLeaveGrant), skipped: calculated.length - toCreate.length }, 201);
  });

  // ---- 有給付与の予告(予告 → 管理者承認 → 本人通知、docs/requirements.md §11) ----
  //
  // 予告行そのものは日次ワーカー(apps/api/src/leave-grant-proposals.ts)が作る。ここは
  // 2段目(管理者の承認・却下)と3段目(本人通知)を担う。認可は POST /leave/grants/auto と
  // 同じ GRANT_MANAGE_PERMISSION + resolveAccessibleUserIds のスコープ判定。

  /** GET /leave/grant-proposals?status=proposed(既定)|approved|rejected|superseded|all */
  app.get("/grant-proposals", async (c) => {
    requirePermission(c, GRANT_MANAGE_PERMISSION, "department_and_descendants");
    const actor = c.get("user");

    const statusParam = c.req.query("status") ?? "proposed";
    if (statusParam !== "all" && !VALID_PROPOSAL_STATUSES.includes(statusParam as LeaveGrantProposalStatus)) {
      return c.json({ error: "invalid_status" }, 400);
    }

    const accessible = await resolveAccessibleUserIds(db, {
      actor: { id: actor.id, tenantId: actor.tenantId, permissions: c.get("permissions") },
      permission: GRANT_MANAGE_PERMISSION,
    });

    const rows = await listLeaveGrantProposals(db, {
      tenantId: actor.tenantId,
      ...(statusParam === "all" ? {} : { statuses: [statusParam as LeaveGrantProposalStatus] }),
      ...(accessible === "all" ? {} : { userIds: [...accessible] }),
    });

    // 氏名・付与区分はテナントのユーザー一覧を1回引いて解決する(予告1件ごとに getUserById を呼ばない)。
    const tenantUsers = await listTenantUsers(db, actor.tenantId);
    const nameById = new Map(tenantUsers.map((u) => [u.id, u.name] as const));
    const grantClassById = new Map(tenantUsers.map((u) => [u.id, resolveLeaveGrantClass(u.leaveGrantClass)] as const));

    return c.json({
      proposals: rows.map((row) =>
        serializeLeaveGrantProposal(row, nameById.get(row.userId) ?? null, grantClassById.get(row.userId) ?? null),
      ),
    });
  });

  /**
   * POST /leave/grant-proposals/:id/approve — 予告を承認して leave_grants を作る。
   *
   * 基準日より前の承認も許す(管理者が事前に承認できることがこのフローの目的の1つ)。
   * その場合でも付与日は予告の grantedOn のまま — 残高計算(@kizami/leave)は grantedOn を
   * 起点に時効・年5日期間を決めるため、承認した日を付与日にすると法定の期間がずれる。
   */
  app.post("/grant-proposals/:id/approve", async (c) => {
    requirePermission(c, GRANT_MANAGE_PERMISSION, "department_and_descendants");
    const actor = c.get("user");

    const existing = await getLeaveGrantProposal(db, { tenantId: actor.tenantId, id: c.req.param("id") });
    if (!existing) return c.json({ error: "not_found" }, 404);

    const accessible = await resolveAccessibleUserIds(db, {
      actor: { id: actor.id, tenantId: actor.tenantId, permissions: c.get("permissions") },
      permission: GRANT_MANAGE_PERMISSION,
    });
    if (accessible !== "all" && !accessible.has(existing.userId)) {
      throw new ForbiddenError(`target user ${existing.userId} is outside actor's scope`);
    }
    if (existing.status !== "proposed") return c.json({ error: "not_proposed" }, 409);

    // 予告と並行して手動付与(POST /leave/grants・/grants/auto)が入っていた場合の二重付与防止。
    const existingGrantDates = await listGrantedOnDates(db, { tenantId: actor.tenantId, userId: existing.userId });
    if (existingGrantDates.has(existing.grantedOn)) return c.json({ error: "grant_already_exists" }, 409);

    const now = nowMinutes();
    let grant: LeaveGrant;
    let updated: LeaveGrantProposal;
    try {
      const result = await db.transaction(async (tx) => {
        const insertedGrant = await insertLeaveGrant(tx, {
          tenantId: actor.tenantId,
          userId: existing.userId,
          leaveType: existing.leaveType,
          grantedOn: existing.grantedOn,
          days: existing.days,
          expiresOn: existing.expiresOn,
          // "proposal": 予告フロー由来の付与(auto〔一括自動計算〕・manual〔個別調整〕とは
          // 経路が違うことを残す。packages/db/src/schema/leave.ts の source コメント参照)。
          source: "proposal",
          createdAt: now,
        });
        const updatedRow = await updateLeaveGrantProposalStatus(tx, {
          tenantId: actor.tenantId,
          id: existing.id,
          fromStatus: "proposed",
          status: "approved",
          decidedBy: actor.id,
          decidedAt: now,
          grantId: insertedGrant.id,
        });
        if (!updatedRow) throw new NotPendingConflictError();

        await insertAuditLog(tx, {
          tenantId: actor.tenantId,
          actorId: actor.id,
          action: "leave_grant_proposal.approve",
          targetType: "leave_grant_proposal",
          targetId: existing.id,
          detail: JSON.stringify({
            userId: existing.userId,
            grantedOn: existing.grantedOn,
            days: existing.days,
            grantId: insertedGrant.id,
            attendanceRate: JSON.parse(existing.attendanceRate) as AttendanceRateReference,
          }),
          occurredAt: now,
        });
        return { insertedGrant, updatedRow };
      });
      grant = result.insertedGrant;
      updated = result.updatedRow;
    } catch (err) {
      if (err instanceof NotPendingConflictError) return c.json({ error: "not_proposed" }, 409);
      throw err;
    }

    // 3段目: 本人への通知(個人チャネルのみ。テナント共有 Webhook には流さない —
    // 「誰に何日付与されたか」は本人の勤怠情報であり共有チャネルの原則に反する)。
    const notificationType = "leave_grant_approved";
    const title = "年次有給休暇が付与されました";
    const body = `年次有給休暇が${existing.days}日付与されました(基準日 ${existing.grantedOn})。`;
    const notification = await createNotificationIfAbsent(db, {
      tenantId: actor.tenantId,
      userId: existing.userId,
      type: notificationType,
      subjectDate: existing.grantedOn,
      title,
      body,
      createdAt: now,
    });
    if (notification) {
      const channels = await buildPersonalChannels(db, { tenantId: actor.tenantId, userId: existing.userId, notificationType }, deps);
      if (channels.length > 0) {
        await dispatch(channels, { to: {}, title, body });
      }
    }

    return c.json({ proposal: serializeLeaveGrantProposal(updated, null), grant: serializeLeaveGrant(grant) }, 201);
  });

  /**
   * POST /leave/grant-proposals/:id/reject { note? } — 予告を却下する。
   *
   * 却下した基準日はワーカーが再提案しない(packages/db/src/queries/leave.ts の
   * findActiveLeaveGrantProposal の判断点)。やはり付与する場合は手動経路
   * (POST /leave/grants/auto または POST /leave/grants)を使う。
   */
  app.post("/grant-proposals/:id/reject", async (c) => {
    requirePermission(c, GRANT_MANAGE_PERMISSION, "department_and_descendants");
    const actor = c.get("user");

    const body = await parseJsonBody(c);
    if (body === null || (body.note !== undefined && body.note !== null && typeof body.note !== "string")) {
      return c.json({ error: "invalid_body" }, 400);
    }
    const note = typeof body.note === "string" ? body.note : null;
    if (note !== null && note.length > MAX_REASON_LENGTH) return c.json({ error: "invalid_body" }, 400);

    const existing = await getLeaveGrantProposal(db, { tenantId: actor.tenantId, id: c.req.param("id") });
    if (!existing) return c.json({ error: "not_found" }, 404);

    const accessible = await resolveAccessibleUserIds(db, {
      actor: { id: actor.id, tenantId: actor.tenantId, permissions: c.get("permissions") },
      permission: GRANT_MANAGE_PERMISSION,
    });
    if (accessible !== "all" && !accessible.has(existing.userId)) {
      throw new ForbiddenError(`target user ${existing.userId} is outside actor's scope`);
    }
    if (existing.status !== "proposed") return c.json({ error: "not_proposed" }, 409);

    const now = nowMinutes();
    const updated = await updateLeaveGrantProposalStatus(db, {
      tenantId: actor.tenantId,
      id: existing.id,
      fromStatus: "proposed",
      status: "rejected",
      decidedBy: actor.id,
      decidedAt: now,
      decisionNote: note,
    });
    if (!updated) return c.json({ error: "not_proposed" }, 409);

    await insertAuditLog(db, {
      tenantId: actor.tenantId,
      actorId: actor.id,
      action: "leave_grant_proposal.reject",
      targetType: "leave_grant_proposal",
      targetId: existing.id,
      detail: JSON.stringify({ userId: existing.userId, grantedOn: existing.grantedOn, days: existing.days, note }),
      occurredAt: now,
    });

    // 却下は本人へ通知しない(付与されなかったことを本人に自動通知すると、8割出勤要件の
    // 判断という機微な文脈が説明抜きで伝わるため。管理者から個別に伝える運用に委ねる)。
    return c.json({ proposal: serializeLeaveGrantProposal(updated, null) });
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
