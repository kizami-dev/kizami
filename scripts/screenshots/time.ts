/**
 * JST 前提の日時ヘルパ(apps/api/src/lib/attendance-date.ts の TZ_OFFSET_MINUTES_JST と同じ前提)。
 * シードするデータは常に「今日」からの相対日付で組み立てるため、撮り直すたびに新鮮な見た目になる。
 *
 * 内部実装は `Temporal.PlainDate` / `PlainYearMonth`(./temporal.ts 経由)に寄せている
 * (2026-08 Temporal 導入)。`CivilDate` はこのスクリプト群だけの内部型なので、シグネチャ自体は
 * 変えていないが呼び出し側(seed-http.ts 等)は既存のまま追従不要。
 */
import { Temporal, type TemporalPlainDate } from "./temporal.js";

const JST_TIME_ZONE = "+09:00";

export interface CivilDate {
  y: number;
  m: number;
  d: number;
}

function toPlainDate(date: CivilDate): TemporalPlainDate {
  return Temporal.PlainDate.from({ year: date.y, month: date.m, day: date.d });
}

function fromPlainDate(date: TemporalPlainDate): CivilDate {
  return { y: date.year, m: date.month, d: date.day };
}

export function jstToday(): CivilDate {
  // Date.now() を時刻源にする(apps/api/src/lib/time.ts の nowMinutes と同じ判断点: テストで
  // 時刻をモックする場合 `Date` だけが差し替わり `Temporal.Now` は差し替わらないため、
  // このスクリプト自体はテストで時刻固定しないが念のため揃えている)。
  const zdt = Temporal.Instant.fromEpochMilliseconds(Date.now()).toZonedDateTimeISO(JST_TIME_ZONE);
  return { y: zdt.year, m: zdt.month, d: zdt.day };
}

export function addDays(base: CivilDate, delta: number): CivilDate {
  return fromPlainDate(toPlainDate(base).add({ days: delta }));
}

/**
 * 月だけ加減する。日(`d`)は元の値をそのまま引き継ぐ(旧実装と同じく month-end のクランプは
 * しない — 例: 1/31 + 1ヶ月は「2月31日」という無効な暦日になり得るが、呼び出し側はいずれも
 * `.y`/`.m` のみを読む(`fmtMonth`・`weekdaysInMonth`)ため実害はない)。
 */
export function addMonths(base: CivilDate, delta: number): CivilDate {
  const shifted = Temporal.PlainYearMonth.from({ year: base.y, month: base.m }).add({ months: delta });
  return { y: shifted.year, m: shifted.month, d: base.d };
}

export function fmtDate(date: CivilDate): string {
  return `${date.y}-${String(date.m).padStart(2, "0")}-${String(date.d).padStart(2, "0")}`;
}

export function fmtMonth(date: CivilDate): string {
  return `${date.y}-${String(date.m).padStart(2, "0")}`;
}

/** JST壁時計(y/m/d h:mi)→ UTC エポック分(apps/api の punch occurredAt と同じ単位)。 */
export function jstMinutes(date: CivilDate, h: number, mi: number): number {
  const zdt = toPlainDate(date).toPlainDateTime({ hour: h, minute: mi }).toZonedDateTime(JST_TIME_ZONE);
  return Math.floor(zdt.toInstant().epochMilliseconds / 60_000);
}

function isWeekday(date: CivilDate): boolean {
  // Temporal.PlainDate#dayOfWeek は ISO 準拠で 1(月)〜7(日)。6=土, 7=日を除外する。
  const weekday = toPlainDate(date).dayOfWeek;
  return weekday !== 6 && weekday !== 7;
}

function daysInMonth(y: number, m: number): number {
  return Temporal.PlainYearMonth.from({ year: y, month: m }).daysInMonth;
}

/** 指定した暦月の平日をすべて昇順で返す(月全体。過去月を打刻で埋めて締める用)。 */
export function weekdaysInMonth(y: number, m: number): CivilDate[] {
  const result: CivilDate[] = [];
  for (let d = 1; d <= daysInMonth(y, m); d++) {
    const date = { y, m, d };
    if (isWeekday(date)) result.push(date);
  }
  return result;
}

/**
 * 「今月・今日より前」の平日を昇順で返す。月初(今日が1〜数日目)ほど要素数は少なくなる
 * (0件もあり得る)— 呼び出し側は配列が短くても壊れないように扱うこと。
 * 先月はすでに締めてしまうため、今月のデータは意図的に先月へ越境させない
 * (締め済み月への打刻は apps/api 側で拒否される)。
 */
export function weekdaysBeforeTodayInCurrentMonth(): CivilDate[] {
  const today = jstToday();
  const result: CivilDate[] = [];
  for (let d = 1; d < today.d; d++) {
    const date = { y: today.y, m: today.m, d };
    if (isWeekday(date)) result.push(date);
  }
  return result;
}
