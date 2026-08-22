/**
 * 失効年休の積立休暇への振替(いわゆる失効年休積立制度)。
 *
 * - 対象: leaveType='annual' で expiresOn <= asOf(時効済み)かつ、まだ振替済みでない付与
 *   (alreadyConvertedGrantIds — DB 側で converted_from_grant_id を持つ stocked 付与の
 *   存在有無から呼び出し側が構築する)
 * - 未消化分(grantedMinutes - usedMinutes)を standardDayMinutes で日数に換算する。
 *   換算で生じる端数(分未満)は切り捨てる(判断点: 積立は整数日単位の運用を前提とする)
 * - 積立上限(stockMaxDays、テナント設定)は「現在保持している積立残高(日数換算)」に
 *   対する上限として扱う。呼び出し側が計算した既存残高(existingStockedDaysTotal)を起点に、
 *   同一バッチ内で複数付与を古い順に処理しながら順次消費する(先に失効した付与を優先して積立てる)
 * - 上限超過分は truncatedDays として返す(呼び出し側が監査用に記録できるよう、
 *   convertedDays=0 でも呼び出し側は「処理済み」として記録し、再実行時に再計算し直さない
 *   —二重振替防止は呼び出し側の DB 層の責務)
 */

import { compareDate } from "./date.js";
import { allocateLeaveUsages } from "./allocation.js";
import type { AllocationOptions, LeaveGrantInput, LeaveUsageInput, StockConversionCandidate } from "./types.js";

export function calculateStockConversions(
  grants: LeaveGrantInput[],
  usages: LeaveUsageInput[],
  options: AllocationOptions & {
    alreadyConvertedGrantIds: ReadonlySet<string>;
    stockMaxDays: number;
    existingStockedDaysTotal: number;
  },
): StockConversionCandidate[] {
  const { standardDayMinutes, alreadyConvertedGrantIds, stockMaxDays, asOf } = options;
  const { byGrant } = allocateLeaveUsages(grants, usages, options);

  const expiredAnnual = byGrant
    .filter((g) => g.leaveType === "annual" && compareDate(g.expiresOn, asOf) <= 0 && !alreadyConvertedGrantIds.has(g.id))
    .sort((a, b) => compareDate(a.grantedOn, b.grantedOn));

  let stockedTotal = options.existingStockedDaysTotal;
  const results: StockConversionCandidate[] = [];

  for (const g of expiredAnnual) {
    // byGrant では時効補正により remainingMinutes は 0 になっているため、
    // grantedMinutes - usedMinutes で「失効時点の未消化分」を再計算する。
    const leftoverMinutes = Math.max(0, g.grantedMinutes - g.usedMinutes);
    const leftoverDays = Math.floor(leftoverMinutes / standardDayMinutes);
    const availableCap = Math.max(0, stockMaxDays - stockedTotal);
    const convertedDays = Math.min(leftoverDays, availableCap);
    const truncatedDays = leftoverDays - convertedDays;
    stockedTotal += convertedDays;
    results.push({ sourceGrantId: g.id, leftoverMinutes, leftoverDays, convertedDays, truncatedDays });
  }

  return results;
}
