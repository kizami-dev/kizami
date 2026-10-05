/**
 * 所定休日のカレンダーから、期間内の所定労働日を数える(2026-10-05、フレックスの契約上の枠)。
 *
 * 所定労働日 = 次のどれにも当たらない日:
 * 1. 法定休日(`CalcSettings.legalHoliday`、その日に有効な版)— 法定休日は所定休日の一部であり、
 *    カレンダーの設定によらず必ず休日として扱う(types.ts の `ScheduledHolidayCalendar` 参照)
 * 2. `extraWorkdays` に無く、かつ次のいずれか:
 *    - `weekdays` の曜日
 *    - `nationalHolidays` が true で、国民の祝日(`@kizami/law` の同梱データ)
 *    - `extraHolidays` の日
 *
 * カレンダーは effective-dated で、各日にその日に有効な版を使う(法定の枠の日割りと同じく、
 * 「日ごとに積み上げる値」なので日ごとに解決する)。版が1つも無い(テナントがまだカレンダーを
 * 保存していない)ときは `DEFAULT_SCHEDULED_HOLIDAY_CALENDAR`(土日・祝日)を使う。
 *
 * 純関数。API(契約上の枠の入力づくり・設定画面の所定労働日数の目安)と、ゴールデンケースの
 * ローダーの両方から使う — 所定労働日の数え方をこの1箇所に置く。
 */

import { isNationalHoliday, isNationalHolidayDataAvailable } from "@kizami/law";
import { daysInMonth, epochDayFromDateString, findSettingsForDate, formatDateString, isLegalHoliday, weekdayFromEpochDay } from "./date.js";
import type { CalendarTimelineSpan, PlainDateString, ScheduledHolidayCalendar, SettingsSpan } from "./types.js";

/**
 * 所定休日のカレンダーの既定(土・日、国民の祝日を所定休日にする)。テナントが版を1つも
 * 保存していないときに使う。土日休み・祝日休みという、事務職で最もよく見る形に合わせた。
 * 契約上の枠を選んだ制度でしか使わないので、既存のテナントの数字には効かない。
 */
export const DEFAULT_SCHEDULED_HOLIDAY_CALENDAR: ScheduledHolidayCalendar = {
  weekdays: [0, 6],
  nationalHolidays: true,
  extraHolidays: [],
  extraWorkdays: [],
};

/** timeline から指定日に有効なカレンダーを返す(版が無ければ既定)。 */
export function findCalendarForDate(date: PlainDateString, timeline: readonly CalendarTimelineSpan[]): ScheduledHolidayCalendar {
  let chosen: CalendarTimelineSpan | undefined;
  for (const span of timeline) {
    if (span.from <= date && (chosen === undefined || span.from > chosen.from)) {
      chosen = span;
    }
  }
  return chosen?.calendar ?? DEFAULT_SCHEDULED_HOLIDAY_CALENDAR;
}

export interface ScheduledWorkDates {
  /** 期間内の所定労働日(昇順) */
  dates: PlainDateString[];
  /**
   * 国民の祝日を所定休日にするカレンダーで、祝日のデータが無い年の日を数えたか。
   * true のとき、その年の祝日は所定労働日として数えられている(エンジンは警告を出す)
   */
  nationalHolidayDataUnavailable: boolean;
}

/**
 * 期間(暦月)内の所定労働日を返す。`settingsTimeline` は法定休日の判定にだけ使う
 * (期間内の各日に有効な版が要る — 他の計算と同じ契約)。
 */
export function listScheduledWorkDates(
  calendarTimeline: readonly CalendarTimelineSpan[],
  settingsTimeline: SettingsSpan[],
  period: { year: number; month: number },
): ScheduledWorkDates {
  const dates: PlainDateString[] = [];
  let nationalHolidayDataUnavailable = false;
  const dim = daysInMonth(period.year, period.month);
  for (let day = 1; day <= dim; day++) {
    const date = formatDateString({ year: period.year, month: period.month, day });
    if (isLegalHoliday(date, findSettingsForDate(date, settingsTimeline).legalHoliday)) continue;

    const calendar = findCalendarForDate(date, calendarTimeline);
    if (calendar.extraWorkdays.includes(date)) {
      dates.push(date);
      continue;
    }
    if (calendar.weekdays.includes(weekdayFromEpochDay(epochDayFromDateString(date)))) continue;
    if (calendar.extraHolidays.includes(date)) continue;
    if (calendar.nationalHolidays) {
      if (!isNationalHolidayDataAvailable(date)) {
        nationalHolidayDataUnavailable = true;
      } else if (isNationalHoliday(date)) {
        continue;
      }
    }
    dates.push(date);
  }
  return { dates, nationalHolidayDataUnavailable };
}
