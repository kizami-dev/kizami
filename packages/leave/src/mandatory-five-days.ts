/**
 * 年5日取得義務の追跡。
 *
 * 対象: 10日以上付与された annual 付与の各期間([grantedOn, grantedOn+1年))。
 * カウント方法(2026-08-22 訂正、根拠は労働基準法39条4項・平21.5.29基発0529001号の解釈と同じ整理):
 * - full_day: 1.0日としてカウント
 * - half_day_am / half_day_pm: 0.5日としてカウント(半休は労使協定不要で、年5日義務にも算入できる)
 * - hourly: **一切カウントしない**(時間単位年休は義務消化に充当できない)
 *
 * FIFO 割当(allocateLeaveUsages)とは独立に、消化日がどの付与の「期間」に暦上含まれるかだけで
 * 判定する(その付与から実際に充当されたかどうかは問わない — 年5日義務は「その基準日から1年の間に
 * 取得した日数」という暦上の話であり、残高消化のバケット割当とは別の軸のため)。
 */

import { addYears, compareDate } from "./date.js";
import type { LeaveGrantInput, LeaveUsageInput, MandatoryFiveDaysStatus } from "./types.js";

const REQUIRED_DAYS = 5;
const MINIMUM_QUALIFYING_DAYS = 10;

/** 浮動小数の誤差を消すため 0.5 刻みに丸める。 */
function roundToHalf(n: number): number {
  return Math.round(n * 2) / 2;
}

export function checkMandatoryFiveDays(
  grants: LeaveGrantInput[],
  usages: LeaveUsageInput[],
  asOf: string,
): MandatoryFiveDaysStatus[] {
  return grants
    .filter((g) => g.leaveType === "annual" && g.days >= MINIMUM_QUALIFYING_DAYS && compareDate(g.grantedOn, asOf) <= 0)
    .map((g) => {
      const periodStart = g.grantedOn;
      const periodEnd = addYears(g.grantedOn, 1);
      const relevant = usages.filter(
        (u) =>
          u.leaveType === "annual" &&
          (u.unit === "full_day" || u.unit === "half_day_am" || u.unit === "half_day_pm") &&
          compareDate(u.date, periodStart) >= 0 &&
          compareDate(u.date, periodEnd) < 0,
      );
      const taken = roundToHalf(relevant.reduce((sum, u) => sum + (u.unit === "full_day" ? 1 : 0.5), 0));
      const shortage = roundToHalf(Math.max(0, REQUIRED_DAYS - taken));
      return {
        grantId: g.id,
        periodStart,
        periodEnd,
        taken,
        required: REQUIRED_DAYS,
        shortage,
        deadline: periodEnd,
        satisfied: shortage === 0,
      } satisfies MandatoryFiveDaysStatus;
    })
    .sort((a, b) => compareDate(a.periodStart, b.periodStart));
}
