/**
 * 日付・時刻ヘルパ(apps/api 専用の薄い実装)。
 *
 * packages/engine の同種のロジック(packages/engine/src/date.ts)は
 * パッケージの公開 API(exports の "." のみ)から参照できないため、
 * 月境界の暦計算に限って本ファイルに最小限を複製する。
 * 純カレンダー演算のみで Temporal.PlainDate を使う分には Node / workerd 双方で同一の結果になる
 * (2026-08 Temporal 導入以前は Date.UTC を使っていたが、性質は同じ)。
 *
 * 内部実装は `Temporal.PlainDate` / `Instant`(lib/temporal.ts 経由)に寄せている。
 * 公開シグネチャ(エポック分 = number, 暦日 = "YYYY-MM-DD" 文字列)は変えていない。
 */
import { Temporal } from "./temporal.js";

const MINUTES_PER_DAY = 1440;
const EPOCH_PLAIN_DATE = Temporal.PlainDate.from("1970-01-01");

/**
 * 現在時刻を UTC エポック分(整数)で返す。
 *
 * 判断点: `Temporal.Now.instant()` ではなく `Date.now()` を時刻源にしている。テスト側は
 * `vi.useFakeTimers()` + `vi.setSystemTime()` で `Date` だけを差し替えており
 * `Temporal.Now` はモックされない(実際に `Temporal.Now.instant()` に変えたところ、
 * 締め・有効期限まわりの「今日」比較テストが軒並み壊れた)。`Date.now()` から得た値を
 * `Temporal.Instant` に変換する分には計算結果は変わらないため、時刻源はそのまま残す。
 */
export function nowMinutes(): number {
  return Math.floor(Temporal.Instant.fromEpochMilliseconds(Date.now()).epochMilliseconds / 60_000);
}

export function formatDate(year: number, month: number, day: number): string {
  return Temporal.PlainDate.from({ year, month, day }).toString();
}

/** 指定 civil month の暦日数。 */
export function daysInMonth(year: number, month: number): number {
  return Temporal.PlainYearMonth.from({ year, month }).daysInMonth;
}

/** "YYYY-MM-DD" → epoch 日数(1970-01-01 = 0)。 */
export function epochDayFromDate(date: string): number {
  return EPOCH_PLAIN_DATE.until(Temporal.PlainDate.from(date), { largestUnit: "day" }).days;
}

/** epoch 日数 → "YYYY-MM-DD"。 */
export function dateFromEpochDay(epochDay: number): string {
  return EPOCH_PLAIN_DATE.add({ days: epochDay }).toString();
}

/** ローカル日 epochDay の 00:00 に対応する UTC エポック分。 */
export function localMidnightUtcMinutes(epochDay: number, tzOffsetMinutes: number): number {
  return epochDay * MINUTES_PER_DAY - tzOffsetMinutes;
}

export interface ParsedMonth {
  year: number;
  month: number;
}

/** "YYYY-MM" をパースする。不正な形式・月番号は null。 */
export function parseMonthParam(value: string | undefined): ParsedMonth | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;
  return { year, month };
}

/** 現在時刻をローカル日付 "YYYY-MM-DD" として返す(§5 有給休暇: asOf の既定値に使う)。 */
export function todayLocalDate(tzOffsetMinutes: number): string {
  const localMinutes = nowMinutes() + tzOffsetMinutes;
  return dateFromEpochDay(Math.floor(localMinutes / MINUTES_PER_DAY));
}
