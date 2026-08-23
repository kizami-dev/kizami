/**
 * 法定付与日数の計算(§5)。通常の付与(週所定5日/フルタイム)に加え、
 * 比例付与(労基法39条3項・労基法施行規則24条の3)にも対応する(2026-08-24 拡張)。
 *
 * 付与日数テーブル(付与の発生順 → 日数。7回目以降は最後の値で上限):
 *
 * | 区分 | 6ヶ月 | 1年6ヶ月 | 2年6ヶ月 | 3年6ヶ月 | 4年6ヶ月 | 5年6ヶ月 | 6年6ヶ月以降 |
 * | --- | --- | --- | --- | --- | --- | --- | --- |
 * | full(週5日以上) | 10 | 11 | 12 | 14 | 16 | 18 | 20 |
 * | days4(週4日) | 7 | 8 | 9 | 10 | 12 | 13 | 15 |
 * | days3(週3日) | 5 | 6 | 6 | 8 | 9 | 10 | 11 |
 * | days2(週2日) | 3 | 4 | 4 | 5 | 6 | 6 | 7 |
 * | days1(週1日) | 1 | 2 | 2 | 2 | 3 | 3 | 3 |
 *
 * 判断点(区分は明示的に受け取り、労働時間からは導出しない):
 * 比例付与の対象は「週所定労働時間30時間未満」**かつ**「週所定労働日数4日以下」という
 * 連言であり、週の所定日数・所定時間の両方を正確に持っていないと判定できない。
 * KIZAMI は雇用契約上の週所定を持たない(シフト制では実際の勤務日数が週ごとに変動し、
 * 実績から推定すると閑散期に区分が下がる)。推定を誤ると**法定より少ない日数しか付与しない**
 * 方向の事故になり、これは労基法39条違反そのものになる。よって区分は就業規則・雇用契約を
 * 知っている管理者が明示的に選ぶ値として受け取り、既定は必ず full(最も多い日数)とする。
 *
 * 年5日取得義務(mandatory-five-days.ts)は「その付与が10日以上か」で判定するため、
 * 比例付与でも days4 の3年6ヶ月(10日)以降は義務の対象になる — 区分ではなく日数で
 * 判定している現行実装がそのまま正しい。
 *
 * 2方式に対応:
 * - statutory(法定・入社日基準): 入社日から6ヶ月後、以降12ヶ月おきに付与
 * - fixed_date(基準日方式・全社一斉): 全社共通の基準日(MM-DD)に毎年付与。
 *   初回付与は「入社6ヶ月後」以降で最初に到来する基準日とする(判断点: 比例按分表による
 *   前倒し調整は行わない。初回間隔が通常の12ヶ月より短くなる場合がある — これが
 *   「基準日方式で初年度が短い場合」の意味)。
 *   2回目以降は初回付与日から毎年(基準日そのものではなく初回付与日基準で+1年ずつ)。
 *   日数は法定と同じテーブルを「付与の発生順」でそのまま適用する(勤続年数の厳密な
 *   按分計算はしない、documented simplification)。
 */

import { addMonths, addYears, compareDate } from "./date.js";
import type { CalculatedGrant, GrantMethod, LeaveGrantClass, PlainDateString } from "./types.js";

/**
 * 区分ごとの付与日数テーブル(労基法39条2項 / 労基法施行規則24条の3)。
 * 添字は「付与の発生順 - 1」。配列長を超えたら最後の値で頭打ち。
 */
const DAYS_TABLE_BY_CLASS: Record<LeaveGrantClass, readonly number[]> = {
  full: [10, 11, 12, 14, 16, 18, 20],
  days4: [7, 8, 9, 10, 12, 13, 15],
  days3: [5, 6, 6, 8, 9, 10, 11],
  days2: [3, 4, 4, 5, 6, 6, 7],
  days1: [1, 2, 2, 2, 3, 3, 3],
};

const GRANT_EXPIRY_YEARS = 2;
/** 無限ループ防止用の安全弁(理論上、通常の勤続年数では到達しない)。 */
const MAX_ITERATIONS = 1000;

/** 区分が未知の値(DB に想定外の文字列が入っている等)なら full にフォールバックする。 */
function tableFor(grantClass: LeaveGrantClass): readonly number[] {
  return DAYS_TABLE_BY_CLASS[grantClass] ?? DAYS_TABLE_BY_CLASS.full;
}

function daysForOccurrence(n: number, grantClass: LeaveGrantClass): number {
  const table = tableFor(grantClass);
  const idx = Math.min(n - 1, table.length - 1);
  return table[idx] as number;
}

/**
 * 付与予定を計算する。
 *
 * @param hireDate 入社日 "YYYY-MM-DD"
 * @param asOf この日までに到来した付与だけを返す(当日を含む)
 * @param method 付与方式
 * @param fixedDateMmDd method が fixed_date のときの基準日 "MM-DD"
 * @param grantClass 付与区分(既定 full = 通常の付与)。比例付与の判断は呼び出し側が持つ
 */
export function calculateStatutoryGrants(
  hireDate: PlainDateString,
  asOf: PlainDateString,
  method: GrantMethod,
  fixedDateMmDd?: string,
  grantClass: LeaveGrantClass = "full",
): CalculatedGrant[] {
  if (method === "fixed_date") {
    if (!fixedDateMmDd || !/^\d{2}-\d{2}$/.test(fixedDateMmDd)) {
      throw new Error("fixedDateMmDd is required and must be 'MM-DD' when method is 'fixed_date'");
    }
    return calculateFixedDateGrants(hireDate, asOf, fixedDateMmDd, grantClass);
  }
  return calculateStatutoryOnlyGrants(hireDate, asOf, grantClass);
}

function calculateStatutoryOnlyGrants(hireDate: PlainDateString, asOf: PlainDateString, grantClass: LeaveGrantClass): CalculatedGrant[] {
  const grants: CalculatedGrant[] = [];
  for (let n = 1; n <= MAX_ITERATIONS; n++) {
    const grantedOn = addMonths(hireDate, 6 + (n - 1) * 12);
    if (compareDate(grantedOn, asOf) > 0) break;
    grants.push({
      leaveType: "annual",
      grantedOn,
      days: daysForOccurrence(n, grantClass),
      expiresOn: addYears(grantedOn, GRANT_EXPIRY_YEARS),
    });
  }
  return grants;
}

/** minDate 以降で最初に到来する mmDd("MM-DD")の日付を返す。 */
function firstOccurrenceOnOrAfter(minDate: PlainDateString, mmDd: string): PlainDateString {
  const year = Number(minDate.slice(0, 4));
  const sameYear = `${year}-${mmDd}`;
  return compareDate(sameYear, minDate) >= 0 ? sameYear : `${year + 1}-${mmDd}`;
}

function calculateFixedDateGrants(
  hireDate: PlainDateString,
  asOf: PlainDateString,
  mmDd: string,
  grantClass: LeaveGrantClass,
): CalculatedGrant[] {
  const minFirstEligible = addMonths(hireDate, 6);
  const firstGrantDate = firstOccurrenceOnOrAfter(minFirstEligible, mmDd);

  const grants: CalculatedGrant[] = [];
  for (let n = 1; n <= MAX_ITERATIONS; n++) {
    const grantedOn = n === 1 ? firstGrantDate : addYears(firstGrantDate, n - 1);
    if (compareDate(grantedOn, asOf) > 0) break;
    grants.push({
      leaveType: "annual",
      grantedOn,
      days: daysForOccurrence(n, grantClass),
      expiresOn: addYears(grantedOn, GRANT_EXPIRY_YEARS),
    });
  }
  return grants;
}

/**
 * 付与区分ごとの日数テーブルの読み取り専用ビュー(UI・ドキュメント・テストで参照する)。
 * 値の定義はこのファイル1箇所。
 */
export const LEAVE_GRANT_CLASS_DAYS_TABLE: Readonly<Record<LeaveGrantClass, readonly number[]>> = DAYS_TABLE_BY_CLASS;

/** 有効な付与区分の一覧(API のバリデーションで使う)。 */
export const LEAVE_GRANT_CLASSES: readonly LeaveGrantClass[] = ["full", "days4", "days3", "days2", "days1"];

/** 任意の値が LeaveGrantClass かを判定する(API の入力検証・DB 値の読み出しで使う)。 */
export function isLeaveGrantClass(value: unknown): value is LeaveGrantClass {
  return typeof value === "string" && (LEAVE_GRANT_CLASSES as readonly string[]).includes(value);
}
