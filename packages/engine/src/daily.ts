/**
 * 勤怠日への配賦と日次集計(docs/design/v01-data-model.md「集計エンジンの入出力」)。
 */

import type { Segment } from "./derive.js";
import {
  attendanceDayEndUtc,
  daysInMonth,
  findLawForDate,
  findSettingsForDate,
  formatDateString,
  isInPeriod,
  isLegalHoliday,
  lateNightOverlapMinutes,
  resolveAttendanceDate,
} from "./date.js";
import type {
  DailyBreakdown,
  LawTimelineSpan,
  PaidLeaveEntry,
  PlainDateString,
  SettingsSpan,
  WorkStretch,
} from "./types.js";

interface DayPiece {
  date: PlainDateString;
  start: number;
  end: number;
}

/**
 * セグメントを勤怠日の窓([D 00:00+db, 翌日00:00+db))で分割する。
 * export しているのは allowances.ts が「実労働セグメントを勤怠日別に分割してから条件と
 * 重ねる」という同じ流儀(lateNightMinutes と同じ)を再利用するため。
 */
export function splitByAttendanceDay(segment: Segment, timeline: SettingsSpan[]): DayPiece[] {
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
  lawTimeline: LawTimelineSpan[],
  period: { year: number; month: number },
  paidLeave: PaidLeaveEntry[],
  stretches: WorkStretch[] = [],
  // 自動控除(auto-break.ts)で workedSegments の末尾から取り除かれた区間。breakSegments
  // (打刻由来)とは別の Map に積み上げ、DailyBreakdown.autoDeductedBreakMinutes を作る
  // — 打刻由来の休憩と自動控除を合算しないという要件(breaks.md)をここでも保つ。
  autoDeductedSegments: Segment[] = [],
): DailyBreakdown[] {
  const workedByDate = new Map<PlainDateString, number>();
  const lateNightByDate = new Map<PlainDateString, number>();
  const breakByDate = new Map<PlainDateString, number>();
  const autoDeductedByDate = new Map<PlainDateString, number>();

  // stretch は分割せず「clockInAt が属する勤怠日」にまるごと帰属させる(日界をまたぐ夜勤は
  // 出勤した日の行に出て、退勤時刻が翌日になる。UI 側で「翌 7:00」のように表示する想定)。
  const stretchesByDate = new Map<PlainDateString, WorkStretch[]>();
  for (const stretch of stretches) {
    const { date } = resolveAttendanceDate(stretch.clockInAt, settingsTimeline);
    if (!isInPeriod(date, period)) continue;
    const list = stretchesByDate.get(date);
    if (list) {
      list.push(stretch);
    } else {
      stretchesByDate.set(date, [stretch]);
    }
  }

  for (const segment of workedSegments) {
    for (const piece of splitByAttendanceDay(segment, settingsTimeline)) {
      if (!isInPeriod(piece.date, period)) continue;
      const minutes = piece.end - piece.start;
      workedByDate.set(piece.date, (workedByDate.get(piece.date) ?? 0) + minutes);
      const settings = findSettingsForDate(piece.date, settingsTimeline);
      const law = findLawForDate(piece.date, lawTimeline);
      const lateNight = lateNightOverlapMinutes(piece.start, piece.end, settings.tzOffsetMinutes, law.lateNight);
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

  for (const segment of autoDeductedSegments) {
    for (const piece of splitByAttendanceDay(segment, settingsTimeline)) {
      if (!isInPeriod(piece.date, period)) continue;
      const minutes = piece.end - piece.start;
      autoDeductedByDate.set(piece.date, (autoDeductedByDate.get(piece.date) ?? 0) + minutes);
    }
  }

  // 同日に複数エントリがある場合は合算する(午前2時間+午後1時間など)
  const paidLeaveMinutesByDate = new Map<PlainDateString, number>();
  for (const entry of paidLeave) {
    paidLeaveMinutesByDate.set(
      entry.date,
      (paidLeaveMinutesByDate.get(entry.date) ?? 0) + entry.minutes,
    );
  }
  const totalDays = daysInMonth(period.year, period.month);
  const days: DailyBreakdown[] = [];

  for (let day = 1; day <= totalDays; day++) {
    const date = formatDateString({ year: period.year, month: period.month, day });
    const settings = findSettingsForDate(date, settingsTimeline);
    const holiday = isLegalHoliday(date, settings.legalHoliday);
    const rawWorked = workedByDate.get(date) ?? 0;
    const paidLeaveMinutes = paidLeaveMinutesByDate.get(date) ?? 0;

    days.push({
      date,
      workedMinutes: holiday ? 0 : rawWorked,
      breakMinutes: breakByDate.get(date) ?? 0,
      autoDeductedBreakMinutes: autoDeductedByDate.get(date) ?? 0,
      lateNightMinutes: lateNightByDate.get(date) ?? 0,
      isLegalHoliday: holiday,
      legalHolidayMinutes: holiday ? rawWorked : 0,
      isPaidLeave: paidLeaveMinutes > 0,
      paidLeaveMinutes,
      stretches: stretchesByDate.get(date) ?? [],
      // シフトの所定は variable.ts(monthly_variable)が埋める。flex/fixed では 0 のまま。
      scheduledMinutes: 0,
      // 固定時間制・monthly_variable の内訳は fixed.ts/variable.ts が埋める。フレックスでは 0 のまま。
      withinScheduledMinutes: 0,
      extraWithinStatutoryMinutes: 0,
      statutoryOvertimeMinutes: 0,
      // 手当は index.ts が allowances.ts の算出結果で上書きする(buildDailyBreakdown は
      // 手当定義タイムラインを受け取らない — lateNight と違い法令パッケージ経由ではなく
      // EngineInput.allowances という別入力のため、他の日次項目と同じこの関数の中で
      // 計算する理由がない)。ここでは空配列で初期化しておく。
      allowances: [],
    });
  }

  return days;
}
