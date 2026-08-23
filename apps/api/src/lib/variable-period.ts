/**
 * monthly_variable(シフト制)の変形期間([periodStart, periodEnd])を決める計算。
 *
 * packages/engine/src/variable.ts の `computeVariablePeriodRange`(非公開の内部関数)と
 * **一言一句同じアルゴリズム**の複製。engine パッケージの公開 API は `calculate()` と型のみで
 * 内部モジュールを import できないため、apps/api/src/lib/time.ts と同じ理由でここに複製する
 * (docs/design/shift-work.md 決定事項3: periodStartDay 起点の1ヶ月、月をまたぐ)。
 *
 * ここがズレると、apps/api が組み立てる EngineInput.shifts/punches の範囲(呼び出し側が
 * 変形期間全体ぶんを渡す契約、types.ts の EngineInput.shifts JSDoc)と、engine 自身が
 * `calculate()` 内部で計算する `variablePeriod` の範囲が食い違い、期間段(③)の計算に
 * 使う実労働が欠落する(過小計上)おそれがある。variable.ts 側を変更したときはこのファイルも
 * 追従すること。
 */

import { dateFromEpochDay, epochDayFromDate, formatDate } from "./time.js";

export interface VariablePeriodRange {
  /** ローカル日付 "YYYY-MM-DD"(両端含む) */
  periodStart: string;
  periodEnd: string;
}

function addMonths(year: number, month: number, delta: number): { year: number; month: number } {
  const total = year * 12 + (month - 1) + delta;
  const y = Math.floor(total / 12);
  const m = total - y * 12 + 1;
  return { year: y, month: m };
}

/** "YYYY-MM-DD" から year/month だけを取り出す(engine の parseDateString 相当、日は不要)。 */
function yearMonthFromDate(date: string): { year: number; month: number } {
  const [yearStr, monthStr] = date.split("-");
  return { year: Number(yearStr), month: Number(monthStr) };
}

/**
 * `period`(締めている暦月)の締めに対応する変形期間を返す。periodStartDay 起点の1ヶ月
 * (例: 16なら 3/16〜4/15 が `period` = 4月 の締めに対応する期間)。
 * periodStartDay は 1〜28 前提(types.ts の WorkSystem コメント参照)。
 */
export function computeVariablePeriodRange(period: { year: number; month: number }, periodStartDay: number): VariablePeriodRange {
  const candidateAnchor = formatDate(period.year, period.month, periodStartDay);
  const candidateEnd = dateFromEpochDay(epochDayFromDate(candidateAnchor) - 1);
  const candidateEndCivil = yearMonthFromDate(candidateEnd);

  let periodEnd: string;
  if (candidateEndCivil.year === period.year && candidateEndCivil.month === period.month) {
    periodEnd = candidateEnd;
  } else {
    // periodStartDay === 1 のときだけここに来る(candidateEnd が前月に丸め込まれるため)。
    const nextMonth = addMonths(period.year, period.month, 1);
    const nextAnchor = formatDate(nextMonth.year, nextMonth.month, periodStartDay);
    periodEnd = dateFromEpochDay(epochDayFromDate(nextAnchor) - 1);
  }

  // periodStart は「periodEnd の翌日(= 次の periodStartDay の出現)」からちょうど1ヶ月前。
  const anchorAfterEnd = dateFromEpochDay(epochDayFromDate(periodEnd) + 1);
  const anchorCivil = yearMonthFromDate(anchorAfterEnd);
  const periodStartMonth = addMonths(anchorCivil.year, anchorCivil.month, -1);
  const periodStart = formatDate(periodStartMonth.year, periodStartMonth.month, periodStartDay);

  return { periodStart, periodEnd };
}
