/**
 * 所定休日のカレンダー(scheduled_holiday_calendar_versions)を engine の CalendarTimelineSpan[] へ
 * 組み立てる(2026-10-05、フレックスの契約上の枠)。
 *
 * 版は全件を取って engine 側(findCalendarForDate)で日付ごとに解決する。版が1行も無いテナントは
 * 空配列になり、engine の既定(土日・祝日、DEFAULT_SCHEDULED_HOLIDAY_CALENDAR)が効く。
 */

import { listScheduledHolidayCalendarVersions, type Database, type ScheduledHolidayCalendarVersion, type Transaction } from "@kizami/db";
import { findCalendarForDate, type CalendarTimelineSpan, type ScheduledHolidayCalendar, type Weekday } from "@kizami/engine";
import { isNationalHoliday } from "@kizami/law";

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

/**
 * 月次の日別の表に付ける休日の印(2026-10-06 追加)。`national` = 国民の祝日、`company` = カレンダーで
 * 個別に足した所定休日(年末年始など)。
 *
 * 判断点: 曜日による所定休日(土日)には印を付けない。表は曜日を見れば分かるうえ、土曜(C)・
 * 法定休日(M)の色分けが既にあるため。印は「曜日だけでは分からない休日」に限る。
 * カレンダーの extraWorkdays(祝日だが営業する日など)は印を付けない。
 * 祝日を所定休日にしない設定(nationalHolidays=false)のテナントでは、祝日にも印を付けない —
 * 表の印は「その会社にとって休日か」を表すもので、暦の注記ではないため。
 */
export type HolidayMark = "national" | "company";

export async function buildHolidayMarks(
  db: Database | Transaction,
  params: { tenantId: string; year: number; month: number },
): Promise<Record<string, HolidayMark>> {
  const timeline = await buildCalendarTimeline(db, params.tenantId);
  const marks: Record<string, HolidayMark> = {};
  const lastDay = new Date(Date.UTC(params.year, params.month, 0)).getUTCDate();
  const prefix = `${params.year}-${String(params.month).padStart(2, "0")}-`;
  for (let d = 1; d <= lastDay; d++) {
    const date = `${prefix}${String(d).padStart(2, "0")}`;
    const calendar = findCalendarForDate(date, timeline);
    if (calendar.extraWorkdays.includes(date)) continue;
    if (calendar.extraHolidays.includes(date)) {
      marks[date] = "company";
    } else if (calendar.nationalHolidays && isNationalHoliday(date)) {
      marks[date] = "national";
    }
  }
  return marks;
}
