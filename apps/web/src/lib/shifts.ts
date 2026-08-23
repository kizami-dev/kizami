/**
 * シフト制(monthly_variable、v0.7 フェーズ3)の純粋ロジック。docs/design/shift-work.md。
 *
 * 変形期間の境界計算・所定分数の算出・法定休日充足の事前チェック(確定前プレビュー用)を持つ。
 * 後者2つは packages/engine・apps/api 側の実装(shiftScheduledMinutes・hasSufficientLegalHolidays)
 * と同じロジックをここに移植したもの — apps/web は既存方針どおり packages/* への依存を
 * 追加しないため(lib/permissions.ts のコメント参照)。最終的な正はサーバー側の判定であり、
 * ここでの計算は「確定前に不足が見える」プレビュー・UI側の補助用途に限る。
 */
import type { ShiftDayDto, ShiftDayType } from "./api";
import { Temporal } from "./temporal";

/** "YYYY-MM-DD" → その日を含む変形期間の開始日("YYYY-MM-DD")。startDay は1〜28。 */
export function variablePeriodStartContaining(dateStr: string, startDay: number): string {
  const date = Temporal.PlainDate.from(dateStr);
  let candidate = date.with({ day: startDay });
  if (Temporal.PlainDate.compare(candidate, date) > 0) {
    candidate = candidate.subtract({ months: 1 });
  }
  return candidate.toString();
}

/** periodStart(変形期間の開始日) → { periodStart, periodEnd }(periodEnd は翌月の同日前日、apps/api と同じ計算)。 */
export function variablePeriodBounds(periodStart: string): { periodStart: string; periodEnd: string } {
  const start = Temporal.PlainDate.from(periodStart);
  const end = start.add({ months: 1 }).subtract({ days: 1 });
  return { periodStart: start.toString(), periodEnd: end.toString() };
}

/** periodStart を deltaMonths ヶ月分ずらした新しい periodStart("YYYY-MM-DD")。前/次の期間ナビゲーション用。 */
export function shiftVariablePeriodStart(periodStart: string, deltaMonths: number): string {
  return Temporal.PlainDate.from(periodStart).add({ months: deltaMonths }).toString();
}

/** [fromDate, toDate] の日付配列("YYYY-MM-DD"、連続・昇順)を組み立てる。 */
export function dateRangeInclusive(fromDate: string, toDate: string): string[] {
  const from = Temporal.PlainDate.from(fromDate);
  const to = Temporal.PlainDate.from(toDate);
  const dates: string[] = [];
  let cur = from;
  while (Temporal.PlainDate.compare(cur, to) <= 0) {
    dates.push(cur.toString());
    cur = cur.add({ days: 1 });
  }
  return dates;
}

/**
 * その日の所定労働時間(分)。packages/engine/src/variable.ts の shiftScheduledMinutes と同じ計算
 * (dayType が work 以外なら0、endMinutes < startMinutes なら日をまたぐ勤務として扱う)。
 */
export function shiftScheduledMinutes(shift: { dayType: ShiftDayType; startMinutes: number; endMinutes: number; breakMinutes: number }): number {
  if (shift.dayType !== "work") return 0;
  const raw = shift.endMinutes - shift.startMinutes;
  const span = raw < 0 ? raw + 1440 : raw;
  return Math.max(0, span - shift.breakMinutes);
}

const DAYS_PER_WEEK = 7;
const WEEKS_FOR_ALTERNATIVE = 4;
const MIN_LEGAL_HOLIDAYS_PER_WEEK = 1;
const MIN_LEGAL_HOLIDAYS_PER_4_WEEKS = 4;

/**
 * 変形期間([periodStart, periodEnd])の法定休日充足を判定する(週1日、または4週4日、労基法35条2項)。
 * apps/api/src/lib/shift-legal-holiday.ts の hasSufficientLegalHolidays と同じロジック(確定前
 * プレビュー用の移植 — ファイル冒頭コメント参照。最終判定は POST /shifts/plans/:id/publish の 409 が行う)。
 */
export function hasSufficientLegalHolidays(params: { days: { date: string; dayType: ShiftDayType }[]; periodStart: string; periodEnd: string }): boolean {
  const { days, periodStart, periodEnd } = params;
  const legalHolidayDates = new Set(days.filter((d) => d.dayType === "legal_holiday").map((d) => d.date));
  const periodDates = dateRangeInclusive(periodStart, periodEnd);

  const fullWeekCount = Math.floor(periodDates.length / DAYS_PER_WEEK);
  let weeklyOk = fullWeekCount > 0;
  for (let w = 0; w < fullWeekCount && weeklyOk; w++) {
    const weekDates = periodDates.slice(w * DAYS_PER_WEEK, (w + 1) * DAYS_PER_WEEK);
    const count = weekDates.filter((d) => legalHolidayDates.has(d)).length;
    if (count < MIN_LEGAL_HOLIDAYS_PER_WEEK) weeklyOk = false;
  }
  if (weeklyOk) return true;

  const windowSize = DAYS_PER_WEEK * WEEKS_FOR_ALTERNATIVE;
  if (periodDates.length < windowSize) return false;
  for (let start = 0; start + windowSize <= periodDates.length; start++) {
    const windowDates = periodDates.slice(start, start + windowSize);
    const count = windowDates.filter((d) => legalHolidayDates.has(d)).length;
    if (count >= MIN_LEGAL_HOLIDAYS_PER_4_WEEKS) return true;
  }
  return false;
}

/** 期間内の shift_days から日付→シフトのマップを作る(グリッド描画・集計の共通ヘルパー)。 */
export function shiftDaysByDate(days: readonly ShiftDayDto[]): Map<string, ShiftDayDto> {
  return new Map(days.map((d) => [d.date, d]));
}

/** その日の曜日(0=日曜〜6=土曜、Temporal.PlainDate#dayOfWeek(1=月〜7=日)を既存の並びに変換)。 */
export function weekdayOf(dateStr: string): 0 | 1 | 2 | 3 | 4 | 5 | 6 {
  return (Temporal.PlainDate.from(dateStr).dayOfWeek % 7) as 0 | 1 | 2 | 3 | 4 | 5 | 6;
}

export interface WeekGridCell {
  date: string;
  /** 期間([periodStart, periodEnd])の範囲内かどうか。範囲外は週の端を埋めるための空セル。 */
  inPeriod: boolean;
}

/**
 * シフト表の週グリッド(行=週、列=曜日〈日〜土〉、docs/design/shift-work.md 決定事項2)を組み立てる。
 * periodStart/periodEnd を含む最小の日曜始まり週の並びに、期間外の日を inPeriod: false で埋める。
 */
export function buildWeekGrid(periodStart: string, periodEnd: string): WeekGridCell[][] {
  const startDow = weekdayOf(periodStart);
  const endDow = weekdayOf(periodEnd);
  const gridStart = Temporal.PlainDate.from(periodStart).subtract({ days: startDow }).toString();
  const gridEnd = Temporal.PlainDate.from(periodEnd).add({ days: 6 - endDow }).toString();

  const allDates = dateRangeInclusive(gridStart, gridEnd);
  const cells: WeekGridCell[] = allDates.map((date) => ({ date, inPeriod: date >= periodStart && date <= periodEnd }));

  const rows: WeekGridCell[][] = [];
  for (let i = 0; i < cells.length; i += 7) {
    rows.push(cells.slice(i, i + 7));
  }
  return rows;
}

/** 期間の暦日数(periodEnd - periodStart + 1)。法定総枠(40h × 暦日数 ÷ 7)の算出に使う。 */
export function calendarDaysInPeriod(periodStart: string, periodEnd: string): number {
  return Temporal.PlainDate.from(periodStart).until(Temporal.PlainDate.from(periodEnd), { largestUnit: "day" }).days + 1;
}

const STATUTORY_WEEKLY_MINUTES = 40 * 60;

/**
 * 変形期間の法定総枠(分、40時間 × 暦日数 ÷ 7、docs/design/shift-work.md「決定事項」)。
 * 確定前プレビュー用の概算(特例措置対象事業場の44時間は考慮しない — テナントの法令プロファイルを
 * 取得する権限が shift.manage 保持者にあるとは限らないため。実際の判定は締め集計側が行う)。
 */
export function statutoryFrameMinutes(periodStart: string, periodEnd: string): number {
  return Math.floor((STATUTORY_WEEKLY_MINUTES * calendarDaysInPeriod(periodStart, periodEnd)) / 7);
}
