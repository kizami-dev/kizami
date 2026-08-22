/**
 * ブラウザ側の日時ヘルパ(JST 固定)。
 *
 * apps/api の集計は Asia/Tokyo 固定オフセット(docs/design/v01-data-model.md)を
 * 前提にしているため、表示側もここでは JST 固定で扱う(ユーザーの端末 TZ に依存しない)。
 */

const JST_OFFSET_MINUTES = 540;
const MINUTES_PER_DAY = 1440;

/** UTC エポック分(整数)。 */
export function nowMinutes(epochMs: number = Date.now()): number {
  return Math.floor(epochMs / 60_000);
}

/** JST の「今日」の [dayStart, dayEnd] を UTC エポック分(inclusive)で返す。 */
export function jstTodayWindow(epochMs: number = Date.now()): { from: number; to: number } {
  const nowMin = nowMinutes(epochMs);
  const localMin = nowMin + JST_OFFSET_MINUTES;
  const dayIndex = Math.floor(localMin / MINUTES_PER_DAY);
  const from = dayIndex * MINUTES_PER_DAY - JST_OFFSET_MINUTES;
  const to = (dayIndex + 1) * MINUTES_PER_DAY - JST_OFFSET_MINUTES - 1;
  return { from, to };
}

/** UTC エポック分 → JST "HH:mm"。 */
export function formatTimeJst(occurredAtMinutes: number): string {
  const localMin = occurredAtMinutes + JST_OFFSET_MINUTES;
  const minuteOfDay = ((localMin % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  const hour = Math.floor(minuteOfDay / 60);
  const minute = minuteOfDay % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/** "YYYY-MM-DD" の JST 日窓を UTC エポック分(inclusive)で返す(jstTodayWindow の任意日付版)。 */
export function dateWindowJst(dateStr: string): { from: number; to: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!match) {
    throw new Error(`dateWindowJst: invalid date "${dateStr}"`);
  }
  const [, y, m, d] = match;
  const utcMidnightMinutes = Date.UTC(Number(y), Number(m) - 1, Number(d)) / 60_000;
  const from = utcMidnightMinutes - JST_OFFSET_MINUTES;
  const to = from + MINUTES_PER_DAY - 1;
  return { from, to };
}

/** "YYYY-MM-DD" + "HH:mm"(input type="time" の値)→ UTC エポック分。不正な形式は null。 */
export function toEpochMinutesJst(dateStr: string, hhmm: string): number | null {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!dateMatch || !timeMatch) return null;
  const [, y, m, d] = dateMatch;
  const [, hh, mm] = timeMatch;
  const utcMidnightMinutes = Date.UTC(Number(y), Number(m) - 1, Number(d)) / 60_000;
  const localMinuteOfDay = Number(hh) * 60 + Number(mm);
  return utcMidnightMinutes - JST_OFFSET_MINUTES + localMinuteOfDay;
}

/** UTC エポック分 → JST "YYYY-MM-DD"。 */
export function dateStrFromEpochMinutesJst(minutes: number): string {
  const localMin = minutes + JST_OFFSET_MINUTES;
  const dayIndex = Math.floor(localMin / MINUTES_PER_DAY);
  const date = new Date(dayIndex * 86_400_000);
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth() + 1;
  const d = date.getUTCDate();
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** UTC エポック分 → JST "M/D(曜) HH:mm"(申請一覧の対象日時表示用)。 */
export function formatDateTimeJst(minutes: number): string {
  return `${formatDateLabel(dateStrFromEpochMinutesJst(minutes))} ${formatTimeJst(minutes)}`;
}

/** "YYYY-MM-DD" → 暦日インデックス(UTC 0時基準の日数)。日付同士の前後比較・差分計算用。 */
function epochDayFromDateStr(dateStr: string): number {
  const parts = dateStr.split("-").map(Number);
  const year = parts[0] ?? 1970;
  const month = parts[1] ?? 1;
  const day = parts[2] ?? 1;
  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);
}

/** JST の暦日 "YYYY-MM-DD" 同士の日数差(b - a)。月次一覧の「翌」判定に使う。 */
export function diffCalendarDaysJst(aDateStr: string, bDateStr: string): number {
  return epochDayFromDateStr(bDateStr) - epochDayFromDateStr(aDateStr);
}

/** "YYYY-MM-DD" → "M/D"(曜日なし)。日をまたいだ退勤時刻の表示など、短く日付だけ示したい場面用。 */
export function formatMonthDayShort(dateStr: string): string {
  const parts = dateStr.split("-").map(Number);
  const month = parts[1] ?? 1;
  const day = parts[2] ?? 1;
  return `${month}/${day}`;
}

/** 分数 → "H:MM" (tabular-nums 表示用)。 */
export function formatDurationHm(minutes: number): string {
  const sign = minutes < 0 ? "-" : "";
  const abs = Math.abs(minutes);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `${sign}${h}:${String(m).padStart(2, "0")}`;
}

export interface YearMonth {
  year: number;
  month: number;
}

/** 現在時刻から JST の当月を返す。 */
export function currentYearMonthJst(epochMs: number = Date.now()): YearMonth {
  const nowMin = nowMinutes(epochMs);
  const localMin = nowMin + JST_OFFSET_MINUTES;
  const dayIndex = Math.floor(localMin / MINUTES_PER_DAY);
  const date = new Date(dayIndex * 86_400_000);
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1 };
}

export function formatMonthParam({ year, month }: YearMonth): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

/** "YYYY-MM" をパースする。不正な形式は null。 */
export function parseMonthParam(value: string | null | undefined): YearMonth | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;
  return { year, month };
}

export function shiftMonth({ year, month }: YearMonth, delta: number): YearMonth {
  const total = year * 12 + (month - 1) + delta;
  return { year: Math.floor(total / 12), month: (total % 12) + 1 };
}

export function formatMonthLabel({ year, month }: YearMonth): string {
  return `${year}年${month}月`;
}

/** "YYYY-MM-DD" → "M/D(曜)"。 */
export function formatDateLabel(dateStr: string): string {
  const parts = dateStr.split("-").map(Number);
  const year = parts[0] ?? 1970;
  const month = parts[1] ?? 1;
  const day = parts[2] ?? 1;
  const weekdayNames = ["日", "月", "火", "水", "木", "金", "土"];
  const weekday = weekdayNames[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
  return `${month}/${day}(${weekday})`;
}

/**
 * 分数 → "○日○時間(○分)"(有給残高の表示用、v0.3)。
 * standardDayMinutes(所定労働時間)で日に換算し、余りを時間・分に分解する。
 * standardDayMinutes が 0 以下の場合は換算できないため分のみを返す(防御的フォールバック)。
 */
export function formatDaysHoursMinutes(minutes: number, standardDayMinutes: number): string {
  const total = Math.max(0, Math.round(minutes));
  if (standardDayMinutes <= 0) return `${total}分`;

  const days = Math.floor(total / standardDayMinutes);
  const remainder = total % standardDayMinutes;
  const hours = Math.floor(remainder / 60);
  const mins = remainder % 60;

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}日`);
  if (hours > 0 || days === 0) parts.push(`${hours}時間`);
  if (mins > 0) parts.push(`${mins}分`);
  return parts.join("");
}
