/**
 * GET /attendance/status, GET /attendance/monthly, GET /attendance/members
 *
 * 他人の勤怠閲覧(2026-08-23、Tier 1): GET /attendance/monthly は `?userId=` を受け付ける。
 * 省略時は従来どおり本人。指定時は `attendance.record.view`(department スコープ以上、
 * docs/design/permission-catalog.md §1.3)を要求したうえで apps/api/src/lib/scope.ts の
 * resolveAccessibleUserIds でスコープ内かを検証する(routes/corrections.ts・
 * routes/auto-break-waivers.ts の GET / と同じ作法)。スコープ外(または存在しないuserId)は
 * 403ではなく404を返す — 「権限はあるが対象がスコープ外」と「対象が存在しない」を区別できて
 * しまうと、権限を持つ攻撃者に他部署のuserIdの存在を推測されるため(依頼どおり)。actor が
 * `attendance.record.view` を一切持たない状態で他人のuserIdを指定した場合は、
 * requirePermission が先に403を返す(こちらは「この操作を行う権限が無い」というactor自身の
 * 話であり、対象userIdの存在を推測させる情報ではないため404にしない)。
 *
 * GET /attendance/members(新設): web の「閲覧対象を切り替えるUI」向けに、閲覧権限のスコープ内
 * メンバー一覧(id・name・departmentId)を返す。`attendance.record.view` を持たない一般従業員は
 * 自分1人だけの配列を受け取る(このエンドポイント自体は権限が無くても403にしない —
 * 「自分は常に含む」を満たすため。権限を持つユーザーだけがスコープを広げられる)。
 *
 * レスポンス契約の破壊的変更(2026-08-23、承認済み): GET /attendance/monthly は
 * 従来のフラットな12キー(days/totals/flexBalance/workSystem/warnings/allowanceTotals/
 * allowanceDefinitions/closed/amended/originalTotals/originalFlexBalance/originalAllowanceTotals)
 * を廃止し、`{ user, workSystem, days, warnings, figures: { source, totals, flexBalance,
 * fixedBreakdown, allowanceTotals, original? }, allowanceDefinitions, closing: { closed, amended } }`
 * へ再編した(設計判断は docs/design/v01-data-model.md 「GET /attendance/monthly レスポンス契約」
 * 節に記録)。互換層は無い(旧形は一切残さない)。`figures.fixedBreakdown`
 * (所定内/法定内残業の月合計)は今回追加した新規フィールドで、旧形では web に渡していなかった
 * (CSVエクスポートと締めスナップショットにしか持っていなかった)。apps/web・apps/mcp は
 * 新形へ同時追従が前提(apps/mcp/src/{types,client,tools}.ts を参照)。
 */

import { Hono } from "hono";
import {
  getClosingSnapshots,
  getClosingState,
  getEffectiveSettingsVersion,
  getOriginalClosingSnapshots,
  getUserById,
  listApprovedLeaveRequestsInRange,
  listApprovedWaiverDatesInRange,
  listTenantMembershipsWithDepartment,
  listTenantUsers,
  listValidPunches,
  type Database,
} from "@kizami/db";
import { calculate, type EngineInput, type PaidLeaveEntry, type PunchKind, type ValidPunch } from "@kizami/engine";
import { resolveUsageMinutes, type LeaveUnit } from "@kizami/leave";
import type { AppEnv } from "../auth/middleware.js";
import { requirePermission, requireSelf } from "../authz.js";
import { buildAllowanceNameMap, buildAllowanceTimeline } from "../lib/allowances.js";
import { engineOutputFromSnapshots, sumFixedBreakdown } from "../lib/closing-snapshot.js";
import { resolveMonthlyVariableExtras } from "../lib/monthly-shifts.js";
import { resolveAccessibleUserIds } from "../lib/scope.js";
import {
  dateFromEpochDay,
  daysInMonth,
  epochDayFromDate,
  formatDate,
  localMidnightUtcMinutes,
  nowMinutes,
  parseMonthParam,
} from "../lib/time.js";
import { buildLawTimelineForTenant, buildSettingsTimeline, standardDayMinutesForDate, TZ_OFFSET_MINUTES_JST } from "../lib/settings.js";

/** docs/design/permission-catalog.md §1.3(勤怠記録閲覧)。 */
const RECORD_VIEW_PERMISSION = "attendance.record.view";

const MINUTES_PER_DAY = 1440;

/**
 * 「当日」の勤怠日の窓([dayStart, dayEnd))を UTC エポック分で解決する。
 *
 * packages/engine の resolveAttendanceDate と同じ「最新版で仮日付→その日の実際の版で
 * 再解決」の2パス方式を、GET /attendance/status のためだけに最小限で再実装している
 * (engine の内部モジュールは公開 API に含まれず import できないため)。
 */
/**
 * apps/api/src/routes/slack.ts(Slackスラッシュコマンド打刻)も、無効な遷移の事前判定と
 * `/punch status` の応答に、この2関数(resolveTodayWindow・deriveStatus)をそのまま再利用する。
 * GET /attendance/status と全く同じロジックで「今の状態」を判定する必要があるため、ここでの
 * export はエクスポート範囲を広げるだけの変更(ロジック自体は変更しない)。
 */
export async function resolveTodayWindow(
  db: Database,
  tenantId: string,
  atMinutes: number,
): Promise<{ dayStart: number; dayEnd: number }> {
  const tz = TZ_OFFSET_MINUTES_JST;
  const localMinutes = atMinutes + tz;
  const roughEpochDay = Math.floor(localMinutes / MINUTES_PER_DAY);
  const minuteOfDay = localMinutes - roughEpochDay * MINUTES_PER_DAY;

  const roughDate = dateFromEpochDay(roughEpochDay);
  const roughVersion = await getEffectiveSettingsVersion(db, { tenantId, onDate: roughDate });
  if (!roughVersion) {
    throw new Error(`no tenant settings version effective on or before ${roughDate}`);
  }

  const attendanceDayIndex = minuteOfDay >= roughVersion.dayBoundaryMinutes ? roughEpochDay : roughEpochDay - 1;
  const attendanceDate = dateFromEpochDay(attendanceDayIndex);

  const version = (await getEffectiveSettingsVersion(db, { tenantId, onDate: attendanceDate })) ?? roughVersion;

  const dayStart = localMidnightUtcMinutes(attendanceDayIndex, tz) + version.dayBoundaryMinutes;
  const dayEnd = localMidnightUtcMinutes(attendanceDayIndex + 1, tz) + version.dayBoundaryMinutes;
  return { dayStart, dayEnd };
}

export type AttendanceState = "out" | "working" | "onBreak";

export interface StatusResult {
  state: AttendanceState;
  lastPunch: { kind: PunchKind; occurredAt: number } | null;
}

/**
 * 有効打刻列の末尾状態を素朴にトレースする(engine の deriveSegments と同じ遷移規則)。
 * 無効な文脈の打刻(勤務外の clock_out/break、勤務中の再 clock_in 等)は無視する。
 * 例外的に「休憩中の clock_out」は休憩を閉じて退勤する有効な遷移として扱う
 * (docs/design/v01-data-model.md「不正打刻列の解釈ルール」参照)。
 */
export function deriveStatus(punches: Array<{ kind: string; occurredAt: number }>): StatusResult {
  let state: AttendanceState = "out";
  let lastPunch: StatusResult["lastPunch"] = null;

  for (const punch of punches) {
    const kind = punch.kind as PunchKind;
    if (state === "out") {
      if (kind === "clock_in") {
        state = "working";
        lastPunch = { kind, occurredAt: punch.occurredAt };
      }
    } else if (state === "working") {
      if (kind === "clock_out") {
        state = "out";
        lastPunch = { kind, occurredAt: punch.occurredAt };
      } else if (kind === "break_start") {
        state = "onBreak";
        lastPunch = { kind, occurredAt: punch.occurredAt };
      }
    } else {
      // onBreak
      if (kind === "break_end") {
        state = "working";
        lastPunch = { kind, occurredAt: punch.occurredAt };
      } else if (kind === "clock_out") {
        state = "out";
        lastPunch = { kind, occurredAt: punch.occurredAt };
      }
    }
  }

  return { state, lastPunch };
}

export function createAttendanceRoutes(db: Database) {
  const app = new Hono<AppEnv>();

  app.get("/status", async (c) => {
    const user = c.get("user");
    requireSelf(c, user.id);

    const { dayStart, dayEnd } = await resolveTodayWindow(db, user.tenantId, nowMinutes());
    const punches = await listValidPunches(db, {
      tenantId: user.tenantId,
      userId: user.id,
      fromMinutes: dayStart,
      toMinutes: dayEnd - 1,
    });

    return c.json(deriveStatus(punches));
  });

  app.get("/monthly", async (c) => {
    const user = c.get("user");
    const permissions = c.get("permissions");

    // 他人の勤怠閲覧(ファイル冒頭コメント参照): ?userId= 省略 or 自分自身の指定は常に許可
    // (requireSelf 相当・権限チェック不要)。他人を指定した場合のみ attendance.record.view を要求する。
    const queryUserId = c.req.query("userId");
    let targetUserId = user.id;
    if (queryUserId !== undefined && queryUserId !== user.id) {
      requirePermission(c, RECORD_VIEW_PERMISSION, "department");
      const accessible = await resolveAccessibleUserIds(db, {
        actor: { id: user.id, tenantId: user.tenantId, permissions },
        permission: RECORD_VIEW_PERMISSION,
      });
      if (accessible !== "all" && !accessible.has(queryUserId)) {
        // 存在推測を避けるため、権限はあるがスコープ外/対象不存在のどちらも一律404
        // (ファイル冒頭コメント参照)。
        return c.json({ error: "not_found" }, 404);
      }
      targetUserId = queryUserId;
    }
    // queryUserId 省略 or 自分自身の指定: 誰でも自分の記録は見られる(権限不要、v0.1からの既定)。

    const targetUser = await getUserById(db, { tenantId: user.tenantId, id: targetUserId });
    if (!targetUser) {
      return c.json({ error: "not_found" }, 404);
    }

    const parsedMonth = parseMonthParam(c.req.query("month"));
    if (!parsedMonth) {
      return c.json({ error: "invalid_month" }, 400);
    }
    const { year, month } = parsedMonth;
    const period = formatDate(year, month, 1).slice(0, 7);

    const monthStartEpochDay = epochDayFromDate(formatDate(year, month, 1));
    const monthEndEpochDay = monthStartEpochDay + daysInMonth(year, month) - 1;
    const monthStartDate = dateFromEpochDay(monthStartEpochDay);
    const monthEndDate = dateFromEpochDay(monthEndEpochDay);

    const tz = TZ_OFFSET_MINUTES_JST;
    // 月初日界の前後1日はみ出しを含めて有効打刻を取得する
    const fromMinutes = localMidnightUtcMinutes(monthStartEpochDay - 1, tz);
    const toMinutes = localMidnightUtcMinutes(monthEndEpochDay + 2, tz) - 1;

    const [punchRows, settingsTimeline, lawTimeline, approvedLeaveRequests, autoBreakWaivedDates, allowanceTimeline] = await Promise.all([
      listValidPunches(db, { tenantId: user.tenantId, userId: targetUserId, fromMinutes, toMinutes }),
      buildSettingsTimeline(db, {
        tenantId: user.tenantId,
        userId: targetUserId,
        fromDate: monthStartDate,
        toDate: monthEndDate,
      }),
      buildLawTimelineForTenant(db, { tenantId: user.tenantId, fromDate: monthStartDate, toDate: monthEndDate }),
      listApprovedLeaveRequestsInRange(db, {
        tenantId: user.tenantId,
        userId: targetUserId,
        fromDate: monthStartDate,
        toDate: monthEndDate,
      }),
      // 判断点(apps/api/src/lib/closing-amend.ts の computeMonthlyForUser と同じ理由・同じコメントを
      // 重複させないためここでは要点のみ): waiveDate は勤怠日(帰属日)であり、engine の
      // isInPeriod フィルタにより月の外に帰属する区間はそもそもこの月の DailyBreakdown に
      // 現れないため、punch 取得のような ±1 日の余裕は不要。月そのものの範囲で足りる。
      listApprovedWaiverDatesInRange(db, {
        tenantId: user.tenantId,
        userId: targetUserId,
        fromDate: monthStartDate,
        toDate: monthEndDate,
      }),
      // 手当(docs/design/allowances.md)。テナント単位の定義なので userId には依存しない。
      buildAllowanceTimeline(db, { tenantId: user.tenantId, fromDate: monthStartDate, toDate: monthEndDate }),
    ]);

    // monthly_variable(シフト制、docs/design/shift-work.md): 変形期間全体(前月にまたがりうる)
    // ぶんの settingsTimeline/lawTimeline/punches/shifts を、暦月だけをカバーする上記の値を
    // baseline として解決し直す。monthly_variable でなければ null(baseline をそのまま使う)。
    const variableExtras = await resolveMonthlyVariableExtras(db, {
      tenantId: user.tenantId,
      userId: targetUserId,
      year,
      month,
      monthStartDate,
      monthEndDate,
      tzOffsetMinutes: tz,
      baseline: { settingsTimeline, lawTimeline, punchFromMinutes: fromMinutes },
    });

    // 変形期間が暦月初日より前(前月)に及ぶ場合だけ、打刻を取り直す(範囲が広がった分だけ)。
    const effectivePunchRows =
      variableExtras && variableExtras.punchFromMinutes < fromMinutes
        ? await listValidPunches(db, {
            tenantId: user.tenantId,
            userId: targetUserId,
            fromMinutes: variableExtras.punchFromMinutes,
            toMinutes,
          })
        : punchRows;

    const effectiveSettingsTimeline = variableExtras?.settingsTimeline ?? settingsTimeline;
    const effectiveLawTimeline = variableExtras?.lawTimeline ?? lawTimeline;

    const punches: ValidPunch[] = effectivePunchRows.map((p) => ({ kind: p.kind as PunchKind, occurredAt: p.occurredAt }));

    // 承認済みの有給取得日を所定労働扱いでフレックス枠に算入する(§5「集計との連動」)。
    // 全休は所定労働時間、半休はその半分、時間単位はその申請分数(単位ごとの分数解決は
    // @kizami/leave の resolveUsageMinutes に委譲する)。同日に複数件(午前+午後の半休等)
    // ある場合は engine 側(calculateFlexBalance)が同一日付のエントリを合算する。
    //
    // 判断点: monthly_variable ユーザーの有給は standardDayMinutesForDate が例外を投げる
    // (lib/settings.ts のコメント参照。シフト所定に基づく分数換算は shift-work.md 実装
    // フェーズ4「有給付与の3段フロー」のスコープ)。本エンドポイントは v0.7 フェーズ2の対象外
    // として未対応のまま残す — 該当ユーザーに承認済み有給が無ければ影響しない。
    const paidLeave: PaidLeaveEntry[] = approvedLeaveRequests.map((r) => ({
      date: r.leaveDate,
      minutes: resolveUsageMinutes(r.unit as LeaveUnit, standardDayMinutesForDate(effectiveSettingsTimeline, r.leaveDate), r.minutes ?? undefined),
    }));

    const input: EngineInput = {
      punches,
      settingsTimeline: effectiveSettingsTimeline,
      lawTimeline: effectiveLawTimeline,
      period: { year, month },
      paidLeave,
      autoBreakWaivedDates,
      allowances: allowanceTimeline,
      ...(variableExtras ? { shifts: variableExtras.shifts } : {}),
    };

    const output = calculate(input);
    // UI が手当の分数(output.days[].allowances・output.allowanceTotals)を definitionId から
    // 人間が読める名前に変換できるよう、id→name マップを常に添える(締め済み・未締めを問わない
    // — 名前は表示専用の付加情報であり、締め保護(下記 figures の上書き)の対象外)。
    const allowanceDefinitions = buildAllowanceNameMap(allowanceTimeline);
    // 固定時間制の内訳(所定内・法定内残業の月合計)。フレックスでは null(closing-snapshot.ts
    // sumFixedBreakdown 参照)。旧形では web に返していなかった新規フィールド(依頼2)。
    const liveFixedBreakdown = output.workSystem === "fixed" ? sumFixedBreakdown(output.days) : null;

    const userDto = { id: targetUser.id, name: targetUser.name };

    // 締め済み月は totals・flexBalance を常にスナップショットから返す(設定変更・制度変更の
    // 遡及から二重に保護する。docs/design/v01-data-model.md 原則6・依頼の禁止事項)。
    // days の明細(日別内訳)は再計算のままでよい(依頼の指示通り。表示用の粒度であり、
    // 締め済みの確定値そのものは figures.totals/flexBalance が担保する)。
    //
    // 締め後修正(amend, v0.4): closingState.history に amend イベントが含まれていれば、
    // 現在の figures(最新世代)は当初の確定値から書き換わっている。UI が「何が・いくら変わったか」
    // を出せるよう、figures.original に当初世代(最初の close)の値を一緒に返す
    // (給与の差額調整に必要 — 依頼)。
    const closingState = await getClosingState(db, { tenantId: user.tenantId, period });
    if (closingState.status === "closed") {
      const snapshots = await getClosingSnapshots(db, { tenantId: user.tenantId, period });
      const userSnapshots = snapshots.filter((s) => s.userId === targetUserId);
      // 手当の月合計(allowanceTotals)も totals/flexBalance と同じ理由で締め保護の対象にする
      // (docs/design/allowances.md「締めとの関係」— 賃金に直結するため)。
      const { totals, flexBalance, fixedBreakdown, allowanceTotals } = engineOutputFromSnapshots(userSnapshots);

      const amended = closingState.history.some((e) => e.event === "amend");
      if (amended) {
        const originalSnapshots = await getOriginalClosingSnapshots(db, { tenantId: user.tenantId, period });
        const userOriginalSnapshots = originalSnapshots.filter((s) => s.userId === targetUserId);
        const {
          totals: originalTotals,
          flexBalance: originalFlexBalance,
          fixedBreakdown: originalFixedBreakdown,
          allowanceTotals: originalAllowanceTotals,
        } = engineOutputFromSnapshots(userOriginalSnapshots);
        return c.json({
          user: userDto,
          workSystem: output.workSystem,
          days: output.days,
          warnings: output.warnings,
          figures: {
            source: "snapshot",
            totals,
            flexBalance,
            fixedBreakdown,
            allowanceTotals,
            // monthly_variable の期間サマリは closing_snapshots に保存していない(依頼
            // 「締めスナップショットは既存の totals 経由でそのまま」— 期間段の時間外は既に
            // totals.overtime に含まれているため、締め済み月は variablePeriod 自体を null にする)。
            variablePeriod: null,
            original: {
              totals: originalTotals,
              flexBalance: originalFlexBalance,
              fixedBreakdown: originalFixedBreakdown,
              allowanceTotals: originalAllowanceTotals,
            },
          },
          allowanceDefinitions,
          closing: { closed: true, amended: true },
        });
      }

      return c.json({
        user: userDto,
        workSystem: output.workSystem,
        days: output.days,
        warnings: output.warnings,
        figures: { source: "snapshot", totals, flexBalance, fixedBreakdown, allowanceTotals, variablePeriod: null },
        allowanceDefinitions,
        closing: { closed: true, amended: false },
      });
    }

    return c.json({
      user: userDto,
      workSystem: output.workSystem,
      days: output.days,
      warnings: output.warnings,
      figures: {
        source: "live",
        totals: output.totals,
        flexBalance: output.flexBalance,
        fixedBreakdown: liveFixedBreakdown,
        allowanceTotals: output.allowanceTotals,
        // monthly_variable のみ非 null(docs/design/shift-work.md 決定事項3)。他の制度では null。
        variablePeriod: output.variablePeriod ?? null,
      },
      allowanceDefinitions,
      closing: { closed: false, amended: false },
    });
  });

  // GET /attendance/members(ファイル冒頭コメント参照): web の閲覧対象切替UI向け。
  // attendance.record.view を持たない場合は自分1人だけを返す(403にしない)。
  app.get("/members", async (c) => {
    const user = c.get("user");
    const permissions = c.get("permissions");

    const accessibleUserIds =
      permissions.get(RECORD_VIEW_PERMISSION) === undefined
        ? new Set([user.id])
        : await resolveAccessibleUserIds(db, {
            actor: { id: user.id, tenantId: user.tenantId, permissions },
            permission: RECORD_VIEW_PERMISSION,
          });

    const [tenantUsers, membershipRows] = await Promise.all([
      listTenantUsers(db, user.tenantId),
      listTenantMembershipsWithDepartment(db, user.tenantId),
    ]);
    const scopedUsers = accessibleUserIds === "all" ? tenantUsers : tenantUsers.filter((u) => accessibleUserIds.has(u.id));

    // membershipRows は createdAt 降順(packages/db/src/queries/members.ts の規約)。
    // 1ユーザーに複数行あり得るため最初に出現した(=最新の)所属だけを採用する。
    const departmentIdByUser = new Map<string, string>();
    for (const m of membershipRows) {
      if (!departmentIdByUser.has(m.userId)) {
        departmentIdByUser.set(m.userId, m.departmentId);
      }
    }

    return c.json({
      members: scopedUsers.map((u) => ({
        id: u.id,
        name: u.name,
        departmentId: departmentIdByUser.get(u.id) ?? null,
      })),
    });
  });

  return app;
}
