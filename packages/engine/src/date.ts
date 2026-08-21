/**
 * 日付演算(自前実装)。
 *
 * - epoch日 ⇔ (year, month, day) は Howard Hinnant の civil calendar アルゴリズム
 *   (http://howardhinnant.github.io/date_algorithms.html) の days_from_civil / civil_from_days に準拠
 * - 曜日は epoch日から算出。1970-01-01 (epoch日 0) = 木曜 = 4
 * - ローカル分 = UTCエポック分 + tzOffsetMinutes(原則5, types.ts コメント)
 *
 * Date オブジェクト・Date.now() は一切使わない。
 */

import type { CalcSettings, LegalHolidayRule, PlainDateString, SettingsSpan } from "./types.js";

export interface CivilDate {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
}

const MINUTES_PER_DAY = 1440;

/** civil date (proleptic Gregorian) → epoch日数(1970-01-01 = 0) */
export function daysFromCivil(year: number, month: number, day: number): number {
  const y = year - (month <= 2 ? 1 : 0);
  const era = Math.floor((y >= 0 ? y : y - 399) / 400);
  const yoe = y - era * 400; // [0, 399]
  const doy = Math.trunc((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1; // [0, 365]
  const doe = yoe * 365 + Math.trunc(yoe / 4) - Math.trunc(yoe / 100) + doy; // [0, 146096]
  return era * 146097 + doe - 719468;
}

/** epoch日数 → civil date */
export function civilFromDays(z: number): CivilDate {
  const zz = z + 719468;
  const era = Math.floor((zz >= 0 ? zz : zz - 146096) / 146097);
  const doe = zz - era * 146097; // [0, 146096]
  const yoe = Math.trunc(
    (doe - Math.trunc(doe / 1460) + Math.trunc(doe / 36524) - Math.trunc(doe / 146096)) / 365,
  ); // [0, 399]
  const y = yoe + era * 400;
  const doy = doe - (365 * yoe + Math.trunc(yoe / 4) - Math.trunc(yoe / 100)); // [0, 365]
  const mp = Math.trunc((5 * doy + 2) / 153); // [0, 11]
  const day = doy - Math.trunc((153 * mp + 2) / 5) + 1; // [1, 31]
  const month = mp + (mp < 10 ? 3 : -9); // [1, 12]
  const year = y + (month <= 2 ? 1 : 0);
  return { year, month, day };
}

/** 曜日: 0=日曜 ... 6=土曜。epoch日 0 (1970-01-01) は木曜(4)。 */
export function weekdayFromEpochDay(epochDay: number): 0 | 1 | 2 | 3 | 4 | 5 | 6 {
  const wd = (((epochDay + 4) % 7) + 7) % 7;
  return wd as 0 | 1 | 2 | 3 | 4 | 5 | 6;
}

export function parseDateString(date: PlainDateString): CivilDate {
  const parts = date.split("-");
  const year = Number(parts[0]);
  const month = Number(parts[1]);
  const day = Number(parts[2]);
  return { year, month, day };
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

export function formatDateString(civil: CivilDate): PlainDateString {
  return `${civil.year}-${pad2(civil.month)}-${pad2(civil.day)}`;
}

export function dateStringFromEpochDay(epochDay: number): PlainDateString {
  return formatDateString(civilFromDays(epochDay));
}

export function epochDayFromDateString(date: PlainDateString): number {
  const civil = parseDateString(date);
  return daysFromCivil(civil.year, civil.month, civil.day);
}

/** 指定 civil month の暦日数 */
export function daysInMonth(year: number, month: number): number {
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  return daysFromCivil(nextYear, nextMonth, 1) - daysFromCivil(year, month, 1);
}

/** ローカル "YYYY-MM-DD" の hh:mm を UTC エポック分に変換(tzOffsetMinutes 分だけローカルが進んでいる) */
export function utcMinutesFromLocalDateTime(
  date: PlainDateString,
  hourMinute: { hour: number; minute: number },
  tzOffsetMinutes: number,
): number {
  const epochDay = epochDayFromDateString(date);
  const localEpochMinutes = epochDay * MINUTES_PER_DAY + hourMinute.hour * 60 + hourMinute.minute;
  return localEpochMinutes - tzOffsetMinutes;
}

/** timeline(from 昇順を仮定しない)から、指定ローカル日付に有効な最新版設定を返す */
export function findSettingsForDate(date: PlainDateString, timeline: SettingsSpan[]): CalcSettings {
  let chosen: SettingsSpan | undefined;
  for (const span of timeline) {
    if (span.from <= date && (chosen === undefined || span.from > chosen.from)) {
      chosen = span;
    }
  }
  if (!chosen) {
    throw new Error(`no settings version effective on or before ${date}`);
  }
  return chosen.settings;
}

/** ある設定(dayBoundary/tzOffset)を仮定した場合の、UTC エポック分に対応する勤怠日 */
function attendanceDateForSettings(utcEpochMinutes: number, settings: CalcSettings): PlainDateString {
  const localMinutes = utcEpochMinutes + settings.tzOffsetMinutes;
  const dayIndex = Math.floor(localMinutes / MINUTES_PER_DAY);
  const minuteOfDay = localMinutes - dayIndex * MINUTES_PER_DAY;
  const attendanceDayIndex = minuteOfDay >= settings.dayBoundaryMinutes ? dayIndex : dayIndex - 1;
  return dateStringFromEpochDay(attendanceDayIndex);
}

/**
 * UTC エポック分の瞬間が属する勤怠日と、その日に有効な設定を解決する。
 *
 * 日界・タイムゾーンは設定版(settingsTimeline)に属するため、日付決定と設定選択は
 * 相互依存する。実務上 tzOffset は版をまたいで変わらない前提のもと、
 * 「timeline の最新版で仮の日付を出す→その日の実際の設定で確定させる」を
 * 2パス行うことで、日界変更が版切替の直前後に来る稀なケースも収束させる。
 */
export function resolveAttendanceDate(
  utcEpochMinutes: number,
  timeline: SettingsSpan[],
): { date: PlainDateString; settings: CalcSettings } {
  const probe = timeline.reduce((latest, span) => (span.from > latest.from ? span : latest), timeline[0] as SettingsSpan);
  let date = attendanceDateForSettings(utcEpochMinutes, probe.settings);
  let settings = findSettingsForDate(date, timeline);
  const refinedDate = attendanceDateForSettings(utcEpochMinutes, settings);
  if (refinedDate !== date) {
    date = refinedDate;
    settings = findSettingsForDate(date, timeline);
  }
  return { date, settings };
}

/** 勤怠日 D の窓([D 00:00+db, 翌日00:00+db)) の終端(排他)を UTC エポック分で返す */
export function attendanceDayEndUtc(date: PlainDateString, settings: CalcSettings): number {
  const epochDay = epochDayFromDateString(date);
  const localBoundaryOfNextDay = (epochDay + 1) * MINUTES_PER_DAY + settings.dayBoundaryMinutes;
  return localBoundaryOfNextDay - settings.tzOffsetMinutes;
}

function rangeOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): number {
  return Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart));
}

/**
 * [start, end) UTC エポック分の区間と、暦時刻 [22:00,24:00) ∪ [00:00,05:00)(ローカル、日ごと)
 * との重なり分数。
 */
export function lateNightOverlapMinutes(start: number, end: number, tzOffsetMinutes: number): number {
  if (end <= start) return 0;
  const localStart = start + tzOffsetMinutes;
  const localEnd = end + tzOffsetMinutes;
  const firstDay = Math.floor(localStart / MINUTES_PER_DAY);
  const lastDay = Math.floor((localEnd - 1) / MINUTES_PER_DAY);
  let total = 0;
  for (let d = firstDay; d <= lastDay; d++) {
    const base = d * MINUTES_PER_DAY;
    total += rangeOverlap(localStart, localEnd, base + 1320, base + 1440); // 22:00-24:00
    total += rangeOverlap(localStart, localEnd, base + 0, base + 300); // 00:00-05:00
  }
  return total;
}

export function isInPeriod(date: PlainDateString, period: { year: number; month: number }): boolean {
  const civil = parseDateString(date);
  return civil.year === period.year && civil.month === period.month;
}

export function isLegalHoliday(date: PlainDateString, rule: LegalHolidayRule): boolean {
  if (rule.kind === "dates") {
    return rule.dates.includes(date);
  }
  const epochDay = epochDayFromDateString(date);
  return weekdayFromEpochDay(epochDay) === rule.weekday;
}
