/**
 * 有給休暇の消化割当(FIFO)。
 *
 * - 消化(LeaveUsageInput)は leaveType(annual/stocked)ごとに独立したプールから、
 *   古い付与(grantedOn 昇順)から順に充当する(FIFO)。繰越(未消化分)は自動的に
 *   古い付与に残り続けるため、時効判定と合わせて「繰越込みの残高」が自然に表現される。
 * - 時間単位年休(unit='hourly')の上限判定は「付与単位」ではなく「年度単位」で行う
 *   (2026-08-22 訂正: 繰越分を時間単位で取得する場合も当年度の上限枠に含める。
 *   平21.5.29基発0529001号)。年度は、その従業員の annual 付与の中から「消化日以前で
 *   最も新しい grantedOn」を基準日とする1年間([grantedOn, grantedOn+1年)) として解決する
 *   (checkMandatoryFiveDays の期間解決と同じ考え方 — 通常、統計的付与サイクルは
 *   grantedOn 同士が連続12ヶ月おきになるため、この解決で切れ目のない年度列になる。
 *   手動付与で不規則な grantedOn を挟んだ場合はこの前提が崩れうる既知の制約)。
 * - 半休(half_day_am/half_day_pm)・全休(full_day)は年度上限の対象外(hourlyのみ対象)。
 */

import { compareDate } from "./date.js";
import { hourlyLeaveCapMinutes } from "./hourly.js";
import type {
  AllocationOptions,
  AllocationResult,
  GrantAllocationState,
  LeaveGrantInput,
  LeaveUsageInput,
  UsageAllocationResult,
} from "./types.js";

function isEligible(grant: LeaveGrantInput, date: string): boolean {
  return compareDate(grant.grantedOn, date) <= 0 && compareDate(date, grant.expiresOn) < 0;
}

/** usage.date 時点で有効な「年度」の基準日(annual 付与のうち grantedOn <= date の最新)を返す。annual 付与が無ければ null。 */
function resolveFiscalPeriodStart(annualGrantsSortedAsc: LeaveGrantInput[], date: string): string | null {
  let chosen: string | null = null;
  for (const g of annualGrantsSortedAsc) {
    if (compareDate(g.grantedOn, date) <= 0 && (chosen === null || compareDate(g.grantedOn, chosen) > 0)) {
      chosen = g.grantedOn;
    }
  }
  return chosen;
}

export function allocateLeaveUsages(
  grants: LeaveGrantInput[],
  usages: LeaveUsageInput[],
  options: AllocationOptions,
): AllocationResult {
  const { standardDayMinutes, hourlyLeaveMaxDays, asOf } = options;
  const hourlyCapMinutes = hourlyLeaveCapMinutes(standardDayMinutes, hourlyLeaveMaxDays);

  const states = new Map<string, GrantAllocationState>();
  for (const g of grants) {
    const grantedMinutes = g.days * standardDayMinutes;
    states.set(g.id, {
      id: g.id,
      leaveType: g.leaveType,
      grantedOn: g.grantedOn,
      days: g.days,
      grantedMinutes,
      expiresOn: g.expiresOn,
      usedMinutes: 0,
      hourlyUsedMinutes: 0,
      remainingMinutes: grantedMinutes,
      expired: compareDate(asOf, g.expiresOn) >= 0,
    });
  }

  const grantsByType = new Map<string, LeaveGrantInput[]>();
  for (const g of grants) {
    const list = grantsByType.get(g.leaveType) ?? [];
    list.push(g);
    grantsByType.set(g.leaveType, list);
  }
  for (const list of grantsByType.values()) {
    list.sort((a, b) => compareDate(a.grantedOn, b.grantedOn) || compareDate(a.expiresOn, b.expiresOn));
  }
  const annualGrantsSortedAsc = grantsByType.get("annual") ?? [];

  const sortedUsages = [...usages].sort((a, b) => compareDate(a.date, b.date));
  const results: UsageAllocationResult[] = [];
  // 年度(基準日文字列)ごとの時間単位年休の累計消化分(繰越分も同じキーに合算される)
  const hourlyUsedByPeriod = new Map<string, number>();

  for (const usage of sortedUsages) {
    const pool = grantsByType.get(usage.leaveType) ?? [];

    let periodKey: string | null = null;
    let periodHourlyOk = true;
    if (usage.unit === "hourly") {
      periodKey = resolveFiscalPeriodStart(annualGrantsSortedAsc, usage.date);
      const usedSoFar = periodKey !== null ? (hourlyUsedByPeriod.get(periodKey) ?? 0) : 0;
      periodHourlyOk = periodKey !== null && usedSoFar + usage.minutes <= hourlyCapMinutes;
    }

    const capacityOnly = pool.find((g) => {
      const state = states.get(g.id) as GrantAllocationState;
      return isEligible(g, usage.date) && state.remainingMinutes >= usage.minutes;
    });

    const chosen = periodHourlyOk ? capacityOnly : undefined;

    if (chosen) {
      const state = states.get(chosen.id) as GrantAllocationState;
      state.remainingMinutes -= usage.minutes;
      state.usedMinutes += usage.minutes;
      if (usage.unit === "hourly") {
        state.hourlyUsedMinutes += usage.minutes;
        if (periodKey !== null) {
          hourlyUsedByPeriod.set(periodKey, (hourlyUsedByPeriod.get(periodKey) ?? 0) + usage.minutes);
        }
      }
      results.push({ usageId: usage.id, grantId: chosen.id });
    } else if (capacityOnly) {
      // 付与としての残余は足りているが、時間単位年休の年度上限に阻まれたケース
      results.push({ usageId: usage.id, grantId: null, reason: "hourly_limit_exceeded" });
    } else {
      results.push({ usageId: usage.id, grantId: null, reason: "no_capacity" });
    }
  }

  // 時効済み付与は残余ゼロ扱いにする(使用実績 usedMinutes 自体は履歴として保持)
  const byGrant = [...states.values()]
    .map((s) => (s.expired ? { ...s, remainingMinutes: 0 } : s))
    .sort((a, b) => compareDate(a.grantedOn, b.grantedOn));

  return { byGrant, usages: results };
}
