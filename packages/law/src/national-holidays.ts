/**
 * 国民の祝日の判定(2026-10-05、フレックスの契約上の枠のための所定休日のカレンダー)。
 *
 * 祝日は「国民の祝日に関する法律」が定める日付で、法令ルール(`LawRules`)と同じく
 * 法律で決まる外部のデータなので、このパッケージに同梱する。KIZAMI が祝日を使うのは
 * **所定休日のカレンダー**(テナントが「国民の祝日を所定休日にする」を選んだとき)で
 * 「その日が所定労働日か」を決める判定だけ。祝日そのものは労基法上の休日ではない
 * (法定休日は労基法35条の週1日 / 4週4日で、祝日を休日にするかは就業規則で決まる)。
 *
 * データの持ち方(判断点):
 * - 内閣府の CSV(毎年2月ごろに翌年分が足される)を scripts/update-national-holidays.mjs で
 *   `national-holidays-data.ts` に変換して同梱する。実行時に外部へ取りに行かない
 *   (このパッケージは I/O を持たない純関数のパッケージであり、Workers でも Node でも同じ答えを
 *   返す必要があるため)
 * - 春分の日・秋分の日は前年2月の官報で初めて確定するため、計算式で先の年まで埋めることはしない。
 *   収録範囲外の年は「データが無い」と明示的に返し(`isNationalHolidayDataAvailable`)、呼び出し側
 *   (エンジン)が警告を出す。黙って「祝日なし」とみなすと、所定労働日が多く数えられて
 *   契約上の枠が膨らむため
 */

import { NATIONAL_HOLIDAY_DATA_FIRST_YEAR, NATIONAL_HOLIDAY_DATA_LAST_YEAR, NATIONAL_HOLIDAY_DATES } from "./national-holidays-data.js";

const HOLIDAY_SET: ReadonlySet<string> = new Set(NATIONAL_HOLIDAY_DATES);

/** 祝日のデータを収録している範囲(年)。画面やドキュメントで「いつまで入っているか」を出すのに使う */
export const NATIONAL_HOLIDAY_DATA_RANGE = {
  firstYear: NATIONAL_HOLIDAY_DATA_FIRST_YEAR,
  lastYear: NATIONAL_HOLIDAY_DATA_LAST_YEAR,
} as const;

/** その日("YYYY-MM-DD")の年が、祝日のデータの収録範囲に入っているか */
export function isNationalHolidayDataAvailable(date: string): boolean {
  const year = Number(date.slice(0, 4));
  return Number.isInteger(year) && year >= NATIONAL_HOLIDAY_DATA_FIRST_YEAR && year <= NATIONAL_HOLIDAY_DATA_LAST_YEAR;
}

/**
 * その日("YYYY-MM-DD")が国民の祝日(振替休日・国民の休日を含む)か。
 * 収録範囲外の年は常に false を返す — 範囲外かどうかは `isNationalHolidayDataAvailable` で別に確かめること。
 */
export function isNationalHoliday(date: string): boolean {
  return HOLIDAY_SET.has(date);
}
