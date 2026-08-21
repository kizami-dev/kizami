/**
 * 勤怠日への配賦と日次集計(docs/design/v01-data-model.md「集計エンジンの入出力」)。
 */

import type { Segment } from "./derive.js";
import {
  attendanceDayEndUtc,
  daysInMonth,
  findSettingsForDate,
  formatDateString,
  isInPeriod,
  isLegalHoliday,
  lateNightOverlapMinutes,
  resolveAttendanceDate,
} from "./date.js";
import type { DailyBreakdown, PlainDateString, SettingsSpan } from "./types.js";

interface DayPiece {
  date: PlainDateString;
  start: number;
  end: number;
}

/** セグメントを勤怠日の窓([D 00:00+db, 翌日00:00+db))で分割する */
function splitByAttendanceDay(segment: Segment, timeline: SettingsSpan[]): DayPiece[] {
  const pieces: DayPiece[] = [];
  let cursor = segment.start;
  while (cursor < segment.end) {
    const { date, settings } = resolveAttendanceDate(cursor, timeline);
    const dayEnd = attendanceDayEndUtc(date, settings);
    const pieceEnd = Math.min(segment.end, dayEnd);
    pieces.push({ date, start: cursor, end: pieceEnd });
    cursor = pieceEnd;
  }
  return pieces;
}

export function buildDailyBreakdown(
  workedSegments: Segment[],
  breakSegments: Segment[],
  settingsTimeline: SettingsSpan[],
  period: { year: number; month: number },
  paidLeaveDays: PlainDateString[],
): DailyBreakdown[] {
  const workedByDate = new Map<PlainDateString, number>();
  const lateNightByDate = new Map<PlainDateString, number>();
  const breakByDate = new Map<PlainDateString, number>();

  for (const segment of workedSegments) {
    for (const piece of splitByAttendanceDay(segment, settingsTimeline)) {
      if (!isInPeriod(piece.date, period)) continue;
      const minutes = piece.end - piece.start;
      workedByDate.set(piece.date, (workedByDate.get(piece.date) ?? 0) + minutes);
      const settings = findSettingsForDate(piece.date, settingsTimeline);
      const lateNight = lateNightOverlapMinutes(piece.start, piece.end, settings.tzOffsetMinutes);
      lateNightByDate.set(piece.date, (lateNightByDate.get(piece.date) ?? 0) + lateNight);
    }
  }

  for (const segment of breakSegments) {
    for (const piece of splitByAttendanceDay(segment, settingsTimeline)) {
      if (!isInPeriod(piece.date, period)) continue;
      const minutes = piece.end - piece.start;
      breakByDate.set(piece.date, (breakByDate.get(piece.date) ?? 0) + minutes);
    }
  }

  const paidLeaveSet = new Set(paidLeaveDays);
  const totalDays = daysInMonth(period.year, period.month);
  const days: DailyBreakdown[] = [];

  for (let day = 1; day <= totalDays; day++) {
    const date = formatDateString({ year: period.year, month: period.month, day });
    const settings = findSettingsForDate(date, settingsTimeline);
    const holiday = isLegalHoliday(date, settings.legalHoliday);
    const rawWorked = workedByDate.get(date) ?? 0;

    days.push({
      date,
      workedMinutes: holiday ? 0 : rawWorked,
      breakMinutes: breakByDate.get(date) ?? 0,
      lateNightMinutes: lateNightByDate.get(date) ?? 0,
      isLegalHoliday: holiday,
      legalHolidayMinutes: holiday ? rawWorked : 0,
      isPaidLeave: paidLeaveSet.has(date),
    });
  }

  return days;
}
