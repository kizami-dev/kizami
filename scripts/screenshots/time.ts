/**
 * JST 前提の日時ヘルパ(apps/api/src/lib/attendance-date.ts の TZ_OFFSET_MINUTES_JST と同じ前提)。
 * シードするデータは常に「今日」からの相対日付で組み立てるため、撮り直すたびに新鮮な見た目になる。
 */
const MINUTES_PER_DAY = 1440;
const TZ_OFFSET_MINUTES_JST = 9 * 60;

export interface CivilDate {
  y: number;
  m: number;
  d: number;
}

export function jstToday(): CivilDate {
  const localMinutes = Math.floor(Date.now() / 60_000) + TZ_OFFSET_MINUTES_JST;
  const epochDay = Math.floor(localMinutes / MINUTES_PER_DAY);
  const dt = new Date(epochDay * 86_400_000);
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
}

export function addDays(base: CivilDate, delta: number): CivilDate {
  const epochDay = Math.floor(Date.UTC(base.y, base.m - 1, base.d) / 86_400_000) + delta;
  const dt = new Date(epochDay * 86_400_000);
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
}

export function addMonths(base: CivilDate, delta: number): CivilDate {
  const totalMonth = base.m - 1 + delta;
  const y = base.y + Math.floor(totalMonth / 12);
  const m = ((totalMonth % 12) + 12) % 12;
  return { y, m: m + 1, d: base.d };
}

export function fmtDate(date: CivilDate): string {
  return `${date.y}-${String(date.m).padStart(2, "0")}-${String(date.d).padStart(2, "0")}`;
}

export function fmtMonth(date: CivilDate): string {
  return `${date.y}-${String(date.m).padStart(2, "0")}`;
}

/** JST壁時計(y/m/d h:mi)→ UTC エポック分(apps/api の punch occurredAt と同じ単位)。 */
export function jstMinutes(date: CivilDate, h: number, mi: number): number {
  return Math.floor(Date.UTC(date.y, date.m - 1, date.d, h, mi) / 60_000) - TZ_OFFSET_MINUTES_JST;
}

function isWeekday(date: CivilDate): boolean {
  const weekday = new Date(Date.UTC(date.y, date.m - 1, date.d)).getUTCDay();
  return weekday !== 0 && weekday !== 6;
}

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
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
