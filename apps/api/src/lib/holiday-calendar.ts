/**
 * 所定休日のカレンダー(scheduled_holiday_calendar_versions)を engine の CalendarTimelineSpan[] へ
 * 組み立てる(2026-10-05、フレックスの契約上の枠)。
 *
 * 版は全件を取って engine 側(findCalendarForDate)で日付ごとに解決する。版が1行も無いテナントは
 * 空配列になり、engine の既定(土日・祝日、DEFAULT_SCHEDULED_HOLIDAY_CALENDAR)が効く。
 */

import { listScheduledHolidayCalendarVersions, type Database, type ScheduledHolidayCalendarVersion, type Transaction } from "@kizami/db";
import type { CalendarTimelineSpan, ScheduledHolidayCalendar, Weekday } from "@kizami/engine";

const LOCAL_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * DB の1行を engine の `ScheduledHolidayCalendar` に戻す。
 *
 * 判断点: 壊れた値(DB を直接書き換えた等)は例外にする。所定休日は契約上の枠(過不足・法定内超過)
 * という集計値に直結するため、settings.ts の toWeekday と同じく「集計に効く値は黙って丸めない」
 * (コアタイムのように警告だけに効く値なら null に倒すが、これはそうではない)。
 */
export function parseCalendarVersion(row: ScheduledHolidayCalendarVersion): ScheduledHolidayCalendar {
  const weekdays = parseJsonArray(row.weekdays, "weekdays");
  const extraHolidays = parseJsonArray(row.extraHolidays, "extra_holidays");
  const extraWorkdays = parseJsonArray(row.extraWorkdays, "extra_workdays");
  if (!weekdays.every((w): w is Weekday => Number.isInteger(w) && (w as number) >= 0 && (w as number) <= 6)) {
    throw new Error(`invalid weekdays in scheduled_holiday_calendar_versions: ${row.weekdays}`);
  }
  const isDate = (d: unknown): d is string => typeof d === "string" && LOCAL_DATE_RE.test(d);
  if (!extraHolidays.every(isDate) || !extraWorkdays.every(isDate)) {
    throw new Error(`invalid dates in scheduled_holiday_calendar_versions: ${row.id}`);
  }
  return { weekdays, nationalHolidays: row.nationalHolidays, extraHolidays, extraWorkdays };
}

function parseJsonArray(raw: string, column: string): unknown[] {
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error(`invalid ${column} in scheduled_holiday_calendar_versions: ${raw}`);
  }
  return parsed;
}

/** テナントの所定休日のカレンダーを engine の形で返す(版が無ければ空配列 = 既定のカレンダー)。 */
export async function buildCalendarTimeline(db: Database | Transaction, tenantId: string): Promise<CalendarTimelineSpan[]> {
  const rows = await listScheduledHolidayCalendarVersions(db, tenantId);
  return rows.map((row) => ({ from: row.effectiveFrom, calendar: parseCalendarVersion(row) }));
}
