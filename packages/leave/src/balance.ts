/**
 * 残高サマリ(annual/stocked を分けて返す)。allocateLeaveUsages の結果を集計するだけの薄い層。
 */

import { addDays, compareDate } from "./date.js";
import { allocateLeaveUsages } from "./allocation.js";
import type {
  AllocationOptions,
  GrantAllocationState,
  LeaveBalanceResult,
  LeaveGrantInput,
  LeaveType,
  LeaveTypeSummary,
  LeaveUsageInput,
} from "./types.js";

const DEFAULT_EXPIRING_SOON_WITHIN_DAYS = 60;

function summarize(byGrant: GrantAllocationState[], leaveType: LeaveType, asOf: string, expiringSoonWithinDays: number): LeaveTypeSummary {
  const grants = byGrant.filter((g) => g.leaveType === leaveType);
  const totalGrantedMinutes = grants.reduce((sum, g) => sum + g.grantedMinutes, 0);
  const usedMinutes = grants.reduce((sum, g) => sum + g.usedMinutes, 0);
  const remainingMinutes = grants.reduce((sum, g) => sum + g.remainingMinutes, 0);
  const threshold = addDays(asOf, expiringSoonWithinDays);
  const expiringSoon = grants.filter((g) => !g.expired && g.remainingMinutes > 0 && compareDate(g.expiresOn, threshold) <= 0);
  return { totalGrantedMinutes, usedMinutes, remainingMinutes, expiringSoon, byGrant: grants };
}

export function calculateBalance(
  grants: LeaveGrantInput[],
  usages: LeaveUsageInput[],
  options: AllocationOptions & { expiringSoonWithinDays?: number },
): LeaveBalanceResult {
  const expiringSoonWithinDays = options.expiringSoonWithinDays ?? DEFAULT_EXPIRING_SOON_WITHIN_DAYS;
  const { byGrant } = allocateLeaveUsages(grants, usages, options);
  return {
    standardDayMinutes: options.standardDayMinutes,
    annual: summarize(byGrant, "annual", options.asOf, expiringSoonWithinDays),
    stocked: summarize(byGrant, "stocked", options.asOf, expiringSoonWithinDays),
  };
}
