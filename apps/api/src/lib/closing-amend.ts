/**
 * 締め後修正(amend)のための月次再計算。
 *
 * 修正申請・休暇申請の承認が締め済み月に影響する場合、`assertAmendAllowed` の許可判定の後、
 * その月をロックしたまま(closed のまま)対象ユーザー1人分の集計だけを再計算し、新しい
 * スナップショット世代として保存する(apps/api/src/routes/corrections.ts・leave.ts が呼ぶ)。
 *
 * 判断点(reminders.ts の calculateMonthlyForUser を再利用しなかった理由): 既存の
 * calculateMonthlyForUser(apps/api/src/reminders.ts)は締め処理(POST /closings/:period/close)
 * が使う既存のヘルパーだが、`paidLeave` を常に空配列で calculate() に渡しており、承認済み
 * 休暇のフレックス反映を含まない(§5「集計との連動」)。amend は「有給1日追加でフレックス実績が
 * 増える」ケース(依頼のテスト6)を正しく再計算する必要があるため、GET /attendance/monthly
 * (apps/api/src/routes/attendance.ts)と同じ組み立て(打刻 + 設定タイムライン + 承認済み有給)を
 * ここに独立実装する。calculateMonthlyForUser 自体は締め処理の既存動作を変えないため未変更。
 *
 * 判断点(`Database | Transaction` を受け取る理由): 依頼は「反映後にスナップショットを
 * 再計算して新世代を保存 + closing_events に amend 追記」を**同一トランザクション**で行うことを
 * 求めている。これを満たすため、内部で使う読み取り関数(listValidPunches・
 * buildSettingsTimeline・listApprovedLeaveRequestsInRange)を `Database | Transaction` 対応に
 * widen した(各関数の定義側にコメントあり)。呼び出し側は承認処理と同じ tx をそのまま渡せる。
 * トランザクション内で使われる可能性があるため、読み取りは(同一コネクションでの並行実行を
 * 避けるため)`Promise.all` にせず逐次 await する。
 */

import { listApprovedLeaveRequestsInRange, listValidPunches, type Database, type Transaction } from "@kizami/db";
import { calculate, type EngineInput, type EngineOutput, type PaidLeaveEntry, type PunchKind, type ValidPunch } from "@kizami/engine";
import { resolveUsageMinutes, type LeaveUnit } from "@kizami/leave";
import { buildSettingsTimeline, standardDayMinutesForDate, TZ_OFFSET_MINUTES_JST } from "./settings.js";
import type { SettingsSpan } from "@kizami/engine";
import { dateFromEpochDay, daysInMonth, epochDayFromDate, formatDate, localMidnightUtcMinutes } from "./time.js";

export interface ComputeMonthlyOutputParams {
  tenantId: string;
  userId: string;
  year: number;
  month: number;
}

/**
 * 1ユーザー・1ヶ月分の EngineOutput(totals・flexBalance を含む)を、承認済み有給を含めて
 * 再計算する。GET /attendance/monthly と同じ余裕幅(月初日界の前後1日)で打刻を取得する。
 */
export interface MonthlyComputation {
  output: EngineOutput;
  settingsTimeline: SettingsSpan[];
}

/**
 * 1ユーザー・1ヶ月分を承認済み有給込みで計算し、集計結果と設定タイムラインの両方を返す。
 * 締め・打刻忘れリマインド・36協定アラート・締め後修正のすべてがこの1本を使う
 * (2026-08-22: それぞれが別実装を持ち、締め処理と各アラートが有給を無視していたため統合)。
 */
export async function computeMonthlyForUser(
  db: Database | Transaction,
  params: ComputeMonthlyOutputParams,
): Promise<MonthlyComputation> {
  const { tenantId, userId, year, month } = params;
  const tz = TZ_OFFSET_MINUTES_JST;

  const monthStartEpochDay = epochDayFromDate(formatDate(year, month, 1));
  const monthEndEpochDay = monthStartEpochDay + daysInMonth(year, month) - 1;
  const monthStartDate = dateFromEpochDay(monthStartEpochDay);
  const monthEndDate = dateFromEpochDay(monthEndEpochDay);

  const fromMinutes = localMidnightUtcMinutes(monthStartEpochDay - 1, tz);
  const toMinutes = localMidnightUtcMinutes(monthEndEpochDay + 2, tz) - 1;

  const punchRows = await listValidPunches(db, { tenantId, userId, fromMinutes, toMinutes });
  const settingsTimeline = await buildSettingsTimeline(db, {
    tenantId,
    userId,
    fromDate: monthStartDate,
    toDate: monthEndDate,
  });
  const approvedLeaveRequests = await listApprovedLeaveRequestsInRange(db, {
    tenantId,
    userId,
    fromDate: monthStartDate,
    toDate: monthEndDate,
  });

  const punches: ValidPunch[] = punchRows.map((p) => ({ kind: p.kind as PunchKind, occurredAt: p.occurredAt }));
  const paidLeave: PaidLeaveEntry[] = approvedLeaveRequests.map((r) => ({
    date: r.leaveDate,
    minutes: resolveUsageMinutes(r.unit as LeaveUnit, standardDayMinutesForDate(settingsTimeline, r.leaveDate), r.minutes ?? undefined),
  }));

  const input: EngineInput = {
    punches,
    settingsTimeline,
    period: { year, month },
    paidLeave,
  };

  return { output: calculate(input), settingsTimeline };
}

/** 集計結果だけが必要な呼び出し向けの薄いラッパー。 */
export async function computeMonthlyOutputForUser(
  db: Database | Transaction,
  params: ComputeMonthlyOutputParams,
): Promise<EngineOutput> {
  return (await computeMonthlyForUser(db, params)).output;
}
