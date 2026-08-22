/**
 * 日付演算ヘルパ(パッケージ内で完結。engine/apps/api の同種ロジックとは意図的に重複させる
 * — packages/engine と同じ「ランタイム非依存パッケージは他パッケージの内部実装に依存しない」方針)。
 *
 * 純カレンダー演算のみで Date.UTC を使う分には Node / workerd 双方で同一の結果になる。
 */

import type { PlainDateString } from "./types.js";

interface DateParts {
  year: number;
  month: number; // 1-12
  day: number;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

function parseDate(date: PlainDateString): DateParts {
  const parts = date.split("-").map(Number);
  return { year: parts[0] ?? 0, month: parts[1] ?? 1, day: parts[2] ?? 1 };
}

function formatDate(p: DateParts): PlainDateString {
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;
}

/** 指定 civil month(1-12)の暦日数。 */
function daysInCalendarMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** ISO "YYYY-MM-DD" は辞書式比較がそのまま日付比較になる(ゼロ埋め前提)。 */
export function compareDate(a: PlainDateString, b: PlainDateString): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function epochDayFromDate(date: PlainDateString): number {
  const { year, month, day } = parseDate(date);
  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);
}

function dateFromEpochDay(epochDay: number): PlainDateString {
  const d = new Date(epochDay * 86_400_000);
  return formatDate({ year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() });
}

export function addDays(date: PlainDateString, days: number): PlainDateString {
  return dateFromEpochDay(epochDayFromDate(date) + days);
}

/** 月単位の加算。加算後の月の末日を超える日は末日にクランプする(例: 1/31 + 1ヶ月 = 2/28)。 */
export function addMonths(date: PlainDateString, months: number): PlainDateString {
  const { year, month, day } = parseDate(date);
  const totalMonths = year * 12 + (month - 1) + months;
  const newYear = Math.floor(totalMonths / 12);
  const newMonth = (totalMonths % 12) + 1;
  const clampedDay = Math.min(day, daysInCalendarMonth(newYear, newMonth));
  return formatDate({ year: newYear, month: newMonth, day: clampedDay });
}

export function addYears(date: PlainDateString, years: number): PlainDateString {
  return addMonths(date, years * 12);
}
