/**
 * 法定付与日数の計算(§5、週所定5日/フルタイム前提。比例付与はスコープ外)。
 *
 * 付与日数テーブル(勤続年数 → 日数、6年6ヶ月以降は20日で上限):
 *   6ヶ月=10 / 1年6ヶ月=11 / 2年6ヶ月=12 / 3年6ヶ月=14 / 4年6ヶ月=16 / 5年6ヶ月=18 / 6年6ヶ月以降=20
 *
 * 2方式に対応:
 * - statutory(法定・入社日基準): 入社日から6ヶ月後、以降12ヶ月おきに付与
 * - fixed_date(基準日方式・全社一斉): 全社共通の基準日(MM-DD)に毎年付与。
 *   初回付与は「入社6ヶ月後」以降で最初に到来する基準日とする(判断点: 比例按分表による
 *   前倒し調整はスコープ外の比例付与に属するため行わない。初回間隔が通常の12ヶ月より
 *   短くなる場合がある — これが「基準日方式で初年度が短い場合」の意味)。
 *   2回目以降は初回付与日から毎年(基準日そのものではなく初回付与日基準で+1年ずつ)。
 *   日数は法定と同じテーブルを「付与の発生順」でそのまま適用する(勤続年数の厳密な
 *   按分計算はしない、documented simplification)。
 */

import { addMonths, addYears, compareDate } from "./date.js";
import type { CalculatedGrant, GrantMethod, PlainDateString } from "./types.js";

const DAYS_TABLE = [10, 11, 12, 14, 16, 18, 20] as const;
const GRANT_EXPIRY_YEARS = 2;
/** 無限ループ防止用の安全弁(理論上、通常の勤続年数では到達しない)。 */
const MAX_ITERATIONS = 1000;

function daysForOccurrence(n: number): number {
  const idx = Math.min(n - 1, DAYS_TABLE.length - 1);
  return DAYS_TABLE[idx] as number;
}

export function calculateStatutoryGrants(
  hireDate: PlainDateString,
  asOf: PlainDateString,
  method: GrantMethod,
  fixedDateMmDd?: string,
): CalculatedGrant[] {
  if (method === "fixed_date") {
    if (!fixedDateMmDd || !/^\d{2}-\d{2}$/.test(fixedDateMmDd)) {
      throw new Error("fixedDateMmDd is required and must be 'MM-DD' when method is 'fixed_date'");
    }
    return calculateFixedDateGrants(hireDate, asOf, fixedDateMmDd);
  }
  return calculateStatutoryOnlyGrants(hireDate, asOf);
}

function calculateStatutoryOnlyGrants(hireDate: PlainDateString, asOf: PlainDateString): CalculatedGrant[] {
  const grants: CalculatedGrant[] = [];
  for (let n = 1; n <= MAX_ITERATIONS; n++) {
    const grantedOn = addMonths(hireDate, 6 + (n - 1) * 12);
    if (compareDate(grantedOn, asOf) > 0) break;
    grants.push({ leaveType: "annual", grantedOn, days: daysForOccurrence(n), expiresOn: addYears(grantedOn, GRANT_EXPIRY_YEARS) });
  }
  return grants;
}

/** minDate 以降で最初に到来する mmDd("MM-DD")の日付を返す。 */
function firstOccurrenceOnOrAfter(minDate: PlainDateString, mmDd: string): PlainDateString {
  const year = Number(minDate.slice(0, 4));
  const sameYear = `${year}-${mmDd}`;
  return compareDate(sameYear, minDate) >= 0 ? sameYear : `${year + 1}-${mmDd}`;
}

function calculateFixedDateGrants(hireDate: PlainDateString, asOf: PlainDateString, mmDd: string): CalculatedGrant[] {
  const minFirstEligible = addMonths(hireDate, 6);
  const firstGrantDate = firstOccurrenceOnOrAfter(minFirstEligible, mmDd);

  const grants: CalculatedGrant[] = [];
  for (let n = 1; n <= MAX_ITERATIONS; n++) {
    const grantedOn = n === 1 ? firstGrantDate : addYears(firstGrantDate, n - 1);
    if (compareDate(grantedOn, asOf) > 0) break;
    grants.push({ leaveType: "annual", grantedOn, days: daysForOccurrence(n), expiresOn: addYears(grantedOn, GRANT_EXPIRY_YEARS) });
  }
  return grants;
}
