/**
 * 時間単位年休の上限計算(2026-08-22 訂正版)。
 *
 * 根拠: 労働基準法39条4項、平21.5.29基発0529001号。
 * 「1日分の時間単位年休の時間数」は所定労働時間数を基準とし、**1時間に満たない端数は
 * 時間単位に切り上げる**(労働者に不利にならない方向の端数処理)。上限日数(労使協定で
 * 5日以内の範囲で定める。既定5日)を掛けたものが年度あたりの時間単位年休の上限になる。
 *
 * 例: 所定労働時間 450分(7時間30分)の場合 → 1日分 = ceil(450/60) = 8時間 = 480分。
 * 上限日数が既定の5日なら、年度の上限は 480 × 5 = 2400分(450 × 5 = 2250分ではない)。
 */

/** 所定労働時間(分)を1時間単位に切り上げる。 */
export function ceilToHourMinutes(minutes: number): number {
  return Math.ceil(minutes / 60) * 60;
}

/** 労使協定で定められる時間単位年休の上限日数の範囲(1〜5日。5日超は法令上不可)。 */
export const HOURLY_LEAVE_MAX_DAYS_MIN = 1;
export const HOURLY_LEAVE_MAX_DAYS_MAX = 5;
export const HOURLY_LEAVE_MAX_DAYS_DEFAULT = 5;

/** 年度あたりの時間単位年休の上限(分)。 */
export function hourlyLeaveCapMinutes(standardDayMinutes: number, hourlyLeaveMaxDays: number): number {
  return ceilToHourMinutes(standardDayMinutes) * hourlyLeaveMaxDays;
}
