/**
 * フレックス集計(docs/design/v01-data-model.md「集計エンジンの入出力」、
 * および要件定義書 §2「v0.1のフレックス仕様」)。
 *
 * 清算期間1ヶ月・コアタイムなし。月枠 = floor(週40h(2400分) × 暦日数 / 7)。
 */

import { daysInMonth, findSettingsForDate, formatDateString, isInPeriod } from "./date.js";
import type { CategorizedMinutes, DailyBreakdown, FlexBalance, PlainDateString, SettingsSpan } from "./types.js";

const WEEKLY_FRAME_MINUTES = 40 * 60; // 週40時間
const OVERTIME_60H_THRESHOLD_MINUTES = 60 * 60; // 月60時間

export function calculateFlexBalance(
  days: DailyBreakdown[],
  settingsTimeline: SettingsSpan[],
  period: { year: number; month: number },
  paidLeaveDays: PlainDateString[],
): { totals: CategorizedMinutes; flexBalance: FlexBalance } {
  // フレックス設定・月枠は期間初日に有効な設定版を使う
  const periodStart = formatDateString({ year: period.year, month: period.month, day: 1 });
  const settings = findSettingsForDate(periodStart, settingsTimeline);

  const dim = daysInMonth(period.year, period.month);
  const frameMinutes = Math.floor((WEEKLY_FRAME_MINUTES * dim) / 7);

  const workedTotal = days.reduce((sum, d) => sum + d.workedMinutes, 0);
  const paidLeaveInPeriod = paidLeaveDays.filter((d) => isInPeriod(d, period)).length;
  const actualMinutes = workedTotal + paidLeaveInPeriod * settings.flex.standardDayMinutes;

  const statutory = Math.min(actualMinutes, frameMinutes);
  const overtime = Math.max(0, actualMinutes - frameMinutes);
  const overtime60h = Math.max(0, overtime - OVERTIME_60H_THRESHOLD_MINUTES);
  const lateNight = days.reduce((sum, d) => sum + d.lateNightMinutes, 0);
  const statutoryHoliday = days.reduce((sum, d) => sum + d.legalHolidayMinutes, 0);

  const diffMinutes = actualMinutes - frameMinutes;

  return {
    totals: { statutory, overtime, overtime60h, lateNight, statutoryHoliday },
    flexBalance: { frameMinutes, actualMinutes, diffMinutes },
  };
}
