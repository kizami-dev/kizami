/**
 * GET /attendance/status, GET /attendance/monthly
 */

import { Hono } from "hono";
import {
  getClosingSnapshots,
  getClosingState,
  getEffectiveSettingsVersion,
  getOriginalClosingSnapshots,
  listApprovedLeaveRequestsInRange,
  listApprovedWaiverDatesInRange,
  listValidPunches,
  type Database,
} from "@kizami/db";
import { calculate, type EngineInput, type PaidLeaveEntry, type PunchKind, type ValidPunch } from "@kizami/engine";
import { resolveUsageMinutes, type LeaveUnit } from "@kizami/leave";
import type { AppEnv } from "../auth/middleware.js";
import { requireSelf } from "../authz.js";
import { buildAllowanceNameMap, buildAllowanceTimeline } from "../lib/allowances.js";
import { engineOutputFromSnapshots } from "../lib/closing-snapshot.js";
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
    requireSelf(c, user.id);

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
      listValidPunches(db, { tenantId: user.tenantId, userId: user.id, fromMinutes, toMinutes }),
      buildSettingsTimeline(db, {
        tenantId: user.tenantId,
        userId: user.id,
        fromDate: monthStartDate,
        toDate: monthEndDate,
      }),
      buildLawTimelineForTenant(db, { tenantId: user.tenantId, fromDate: monthStartDate, toDate: monthEndDate }),
      listApprovedLeaveRequestsInRange(db, {
        tenantId: user.tenantId,
        userId: user.id,
        fromDate: monthStartDate,
        toDate: monthEndDate,
      }),
      // 判断点(apps/api/src/lib/closing-amend.ts の computeMonthlyForUser と同じ理由・同じコメントを
      // 重複させないためここでは要点のみ): waiveDate は勤怠日(帰属日)であり、engine の
      // isInPeriod フィルタにより月の外に帰属する区間はそもそもこの月の DailyBreakdown に
      // 現れないため、punch 取得のような ±1 日の余裕は不要。月そのものの範囲で足りる。
      listApprovedWaiverDatesInRange(db, {
        tenantId: user.tenantId,
        userId: user.id,
        fromDate: monthStartDate,
        toDate: monthEndDate,
      }),
      // 手当(docs/design/allowances.md)。テナント単位の定義なので userId には依存しない。
      buildAllowanceTimeline(db, { tenantId: user.tenantId, fromDate: monthStartDate, toDate: monthEndDate }),
    ]);

    const punches: ValidPunch[] = punchRows.map((p) => ({ kind: p.kind as PunchKind, occurredAt: p.occurredAt }));

    // 承認済みの有給取得日を所定労働扱いでフレックス枠に算入する(§5「集計との連動」)。
    // 全休は所定労働時間、半休はその半分、時間単位はその申請分数(単位ごとの分数解決は
    // @kizami/leave の resolveUsageMinutes に委譲する)。同日に複数件(午前+午後の半休等)
    // ある場合は engine 側(calculateFlexBalance)が同一日付のエントリを合算する。
    const paidLeave: PaidLeaveEntry[] = approvedLeaveRequests.map((r) => ({
      date: r.leaveDate,
      minutes: resolveUsageMinutes(r.unit as LeaveUnit, standardDayMinutesForDate(settingsTimeline, r.leaveDate), r.minutes ?? undefined),
    }));

    const input: EngineInput = {
      punches,
      settingsTimeline,
      lawTimeline,
      period: { year, month },
      paidLeave,
      autoBreakWaivedDates,
      allowances: allowanceTimeline,
    };

    const output = calculate(input);
    // UI が手当の分数(output.days[].allowances・output.allowanceTotals)を definitionId から
    // 人間が読める名前に変換できるよう、id→name マップを常に添える(締め済み・未締めを問わない
    // — 名前は表示専用の付加情報であり、締め保護(下記 totals/flexBalance の上書き)の対象外)。
    const allowanceDefinitions = buildAllowanceNameMap(allowanceTimeline);

    // 締め済み月は totals・flexBalance を常にスナップショットから返す(設定変更・制度変更の
    // 遡及から二重に保護する。docs/design/v01-data-model.md 原則6・依頼の禁止事項)。
    // days の明細(日別内訳)は再計算のままでよい(依頼の指示通り。表示用の粒度であり、
    // 締め済みの確定値そのものは totals/flexBalance が担保する)。
    //
    // 締め後修正(amend, v0.4): closingState.history に amend イベントが含まれていれば、
    // 現在の totals/flexBalance(最新世代)は当初の確定値から書き換わっている。UI が
    // 「何が・いくら変わったか」を出せるよう、amended フラグと当初世代(最初の close)の
    // 値(originalTotals/originalFlexBalance)を一緒に返す(給与の差額調整に必要 — 依頼)。
    const closingState = await getClosingState(db, { tenantId: user.tenantId, period });
    if (closingState.status === "closed") {
      const snapshots = await getClosingSnapshots(db, { tenantId: user.tenantId, period });
      const userSnapshots = snapshots.filter((s) => s.userId === user.id);
      // 手当の月合計(allowanceTotals)も totals/flexBalance と同じ理由で締め保護の対象にする
      // (docs/design/allowances.md「締めとの関係」— 賃金に直結するため)。
      const { totals, flexBalance, allowanceTotals } = engineOutputFromSnapshots(userSnapshots);

      const amended = closingState.history.some((e) => e.event === "amend");
      if (amended) {
        const originalSnapshots = await getOriginalClosingSnapshots(db, { tenantId: user.tenantId, period });
        const userOriginalSnapshots = originalSnapshots.filter((s) => s.userId === user.id);
        const { totals: originalTotals, flexBalance: originalFlexBalance, allowanceTotals: originalAllowanceTotals } =
          engineOutputFromSnapshots(userOriginalSnapshots);
        return c.json({
          ...output,
          totals,
          flexBalance,
          allowanceTotals,
          allowanceDefinitions,
          closed: true,
          amended: true,
          originalTotals,
          originalFlexBalance,
          originalAllowanceTotals,
        });
      }

      return c.json({ ...output, totals, flexBalance, allowanceTotals, allowanceDefinitions, closed: true, amended: false });
    }

    return c.json({ ...output, allowanceDefinitions, closed: false, amended: false });
  });

  return app;
}
