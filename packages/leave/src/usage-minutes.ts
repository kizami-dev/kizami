/**
 * 取得単位(LeaveUnit)ごとの分数解決。DB非依存の純関数として切り出し、apps/api とテストの
 * 両方から同じロジックを参照できるようにする。
 *
 * - full_day: 所定労働時間(standardDayMinutes)そのまま
 * - half_day_am / half_day_pm: 所定労働時間の半分。**端数が出ても切り捨てない**
 *   (例: 所定450分 → 225分。2026-08-22 仕様: 半休は分単位でそのまま扱う)
 * - hourly: 呼び出し側が指定した分数(必須・正の整数)
 */

import type { LeaveUnit } from "./types.js";

export function resolveUsageMinutes(unit: LeaveUnit, standardDayMinutes: number, explicitMinutes?: number): number {
  switch (unit) {
    case "full_day":
      return standardDayMinutes;
    case "half_day_am":
    case "half_day_pm":
      return standardDayMinutes / 2;
    case "hourly":
      if (explicitMinutes === undefined || !Number.isInteger(explicitMinutes) || explicitMinutes <= 0) {
        throw new Error("hourly unit requires a positive integer explicitMinutes value");
      }
      return explicitMinutes;
    default: {
      const _exhaustive: never = unit;
      throw new Error(`unknown leave unit: ${String(_exhaustive)}`);
    }
  }
}
