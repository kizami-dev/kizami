/**
 * monthly_variable(シフト制)ユーザーの月次集計に必要な追加データを解決する。
 *
 * packages/engine の `EngineInput.shifts` JSDoc(types.ts)の契約: 「`period`(締めている暦月)の
 * 月内の日だけでなく、変形期間全体(periodStartDay 起点の1ヶ月。月をまたぐため前後の月の日を
 * 含みうる)ぶんを渡すこと。punches も同様に期間全体分を渡す前提になる」を満たすため、
 * GET /attendance/monthly(routes/attendance.ts)と締め・締め後修正(lib/closing-amend.ts)の
 * 両方が共通で使う。
 *
 * 呼び出し側は先に「暦月だけをカバーする」通常の settingsTimeline/lawTimeline/punch取得範囲
 * (既存の GET /attendance/monthly・computeMonthlyForUser がそのまま行っている処理)を組み立て、
 * それを `baseline` としてこの関数に渡す。monthly_variable でなければ null を返す(呼び出し側は
 * baseline をそのまま使い続ける)。monthly_variable なら、変形期間が暦月をまたいで前月に
 * 及ぶ場合だけ settingsTimeline/lawTimeline/punch取得範囲を期間開始日まで広げ直す
 * (またがらない場合は baseline を再利用してクエリを増やさない)。
 */

import { listValidShiftDaysInRange, type Database, type Transaction } from "@kizami/db";
import type { LawTimelineSpan, SettingsSpan, ShiftDay, ShiftDayType } from "@kizami/engine";
import { buildLawTimelineForTenant, buildSettingsTimeline, resolveWorkSystemForDate } from "./settings.js";
import { epochDayFromDate, localMidnightUtcMinutes } from "./time.js";
import { computeVariablePeriodRange } from "./variable-period.js";

export interface MonthlyBaseline {
  settingsTimeline: SettingsSpan[];
  lawTimeline: LawTimelineSpan[];
  /** 暦月だけをカバーする通常の打刻取得下限(UTC エポック分)。monthly_variable でなければそのまま使う値 */
  punchFromMinutes: number;
}

export interface MonthlyVariableExtras {
  settingsTimeline: SettingsSpan[];
  lawTimeline: LawTimelineSpan[];
  shifts: ShiftDay[];
  /** 変形期間の開始が暦月より前に及ぶ場合、そこまで広げた打刻取得下限(UTC エポック分) */
  punchFromMinutes: number;
  periodStart: string;
  periodEnd: string;
}

export interface ResolveMonthlyVariableExtrasParams {
  tenantId: string;
  userId: string;
  year: number;
  month: number;
  monthStartDate: string;
  monthEndDate: string;
  tzOffsetMinutes: number;
  baseline: MonthlyBaseline;
}

/**
 * monthly_variable でなければ null。monthly_variable なら追加データを組み立てて返す。
 * `Database | Transaction` を受け取る(lib/closing-amend.ts が同一トランザクションで使うため、
 * 他の buildXxx 系と同じ理由)。
 */
export async function resolveMonthlyVariableExtras(
  db: Database | Transaction,
  params: ResolveMonthlyVariableExtrasParams,
): Promise<MonthlyVariableExtras | null> {
  const { tenantId, userId, year, month, monthStartDate, monthEndDate, tzOffsetMinutes, baseline } = params;

  const workSystem = resolveWorkSystemForDate(baseline.settingsTimeline, monthStartDate);
  if (workSystem.kind !== "monthly_variable") return null;

  const { periodStart, periodEnd } = computeVariablePeriodRange({ year, month }, workSystem.periodStartDay);

  // 変形期間の開始が暦月初日より前(前月)に及ぶ場合だけ範囲を広げ直す。及ばない場合
  // (periodStartDay が暦月初日と一致する等)は baseline をそのまま再利用してクエリを増やさない。
  const needsWiderRange = periodStart < monthStartDate;

  const settingsTimeline = needsWiderRange
    ? await buildSettingsTimeline(db, { tenantId, userId, fromDate: periodStart, toDate: monthEndDate })
    : baseline.settingsTimeline;
  const lawTimeline = needsWiderRange
    ? await buildLawTimelineForTenant(db, { tenantId, fromDate: periodStart, toDate: monthEndDate })
    : baseline.lawTimeline;

  const shiftRows = await listValidShiftDaysInRange(db, { tenantId, userId, fromDate: periodStart, toDate: periodEnd });
  const shifts: ShiftDay[] = shiftRows.map((row) => ({
    date: row.date,
    dayType: row.dayType as ShiftDayType,
    startMinutes: row.startMinutes,
    endMinutes: row.endMinutes,
    breakMinutes: row.breakMinutes,
  }));

  // 打刻の日跨ぎ分を取りこぼさないよう、既存の月初±1日と同じ「前日分」の余裕を
  // 期間開始日の前にも持たせる(GET /attendance/monthly・computeMonthlyForUser の既存の
  // fromMinutes 計算と同じ流儀)。
  const punchFromMinutes = needsWiderRange
    ? localMidnightUtcMinutes(epochDayFromDate(periodStart) - 1, tzOffsetMinutes)
    : baseline.punchFromMinutes;

  return { settingsTimeline, lawTimeline, shifts, punchFromMinutes, periodStart, periodEnd };
}
