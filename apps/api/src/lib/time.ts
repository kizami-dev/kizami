/**
 * 日付・時刻ヘルパ(apps/api 専用の薄い実装)。
 *
 * packages/engine の同種のロジック(packages/engine/src/date.ts)は
 * パッケージの公開 API(exports の "." のみ)から参照できないため、
 * 月境界の暦計算に限って本ファイルに最小限を複製する。
 * 純カレンダー演算のみで Date.UTC を使う分には Node / workerd 双方で同一の結果になる。
 */

const MINUTES_PER_DAY = 1440;

/** 現在時刻を UTC エポック分(整数)で返す。 */
export function nowMinutes(): number {
  return Math.floor(Date.now() / 60_000);
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

export function formatDate(year: number, month: number, day: number): string {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

/** 指定 civil month の暦日数。 */
export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** "YYYY-MM-DD" → epoch 日数(1970-01-01 = 0)。 */
export function epochDayFromDate(date: string): number {
  const parts = date.split("-").map(Number);
  const year = parts[0] ?? 0;
  const month = parts[1] ?? 1;
  const day = parts[2] ?? 1;
  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);
}

/** epoch 日数 → "YYYY-MM-DD"。 */
export function dateFromEpochDay(epochDay: number): string {
  const d = new Date(epochDay * 86_400_000);
  return formatDate(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
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
