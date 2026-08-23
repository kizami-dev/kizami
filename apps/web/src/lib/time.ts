/**
 * ブラウザ側の日時ヘルパ(JST 固定)。
 *
 * apps/api の集計は Asia/Tokyo 固定オフセット(docs/design/v01-data-model.md)を
 * 前提にしているため、表示側もここでは JST 固定で扱う(ユーザーの端末 TZ に依存しない)。
 *
 * 曜日・月日の「見せ方」(2026-08-23 4言語対応で追加)は `lib/i18n#getMessages().time` に
 * 委譲する。`getMessages()` はモジュールスコープの現在ロケールを都度読むだけの同期関数
 * (フックではない)なので、ここでは locale の受け渡しを一切気にせず呼べる。呼び出し元
 * コンポーネントが言語切り替え時に再レンダリング(lib/messages.ts のコメント参照)されれば、
 * この関数群も次の描画で新しい言語の値を返す。
 */
import { getMessages } from "./i18n";

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

/**
 * 分(0〜1439) → "HH:MM"(24時間表記、時刻入力欄の表示用)。
 *
 * 判断点(完了報告に明記): SettingsAttendanceView・SettingsAllowancesView・lib/allowances.ts に
 * それぞれ同名・同実装のヘルパーが3箇所(hmToMinutes は2箇所)独立に存在していた(各ファイルの
 * コメントに「既存方針どおりファイルごとに小さく再実装」とあったが、実際には完全に同一の実装
 * だったため、ここへ集約する)。formatDurationHm(上記、符号付き・分単位を跨いだ経過時間表示用)
 * とは用途が異なる(常に非負・0埋め2桁固定の「時刻」表示専用)ため、別関数として残す。
 */
export function minutesToHm(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h < 10 ? `0${h}` : h}:${m < 10 ? `0${m}` : m}`;
}

/** "HH:MM" → 分(0〜1439)。不正な形式は null。minutesToHm の逆変換。 */
export function hmToMinutes(hm: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(hm);
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  return h * 60 + m;
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
  return getMessages().time.monthLabel(year, month);
}

/** "YYYY-MM-DD" → "M/D(曜)"(ロケールごとの曜日表記・並びは lib/i18n の各辞書 time.* が持つ)。 */
export function formatDateLabel(dateStr: string): string {
  const parts = dateStr.split("-").map(Number);
  const year = parts[0] ?? 1970;
  const month = parts[1] ?? 1;
  const day = parts[2] ?? 1;
  const time = getMessages().time;
  // getUTCDay() は必ず 0〜6 を返すため weekdayShort の範囲外にはならないが、
  // noUncheckedIndexedAccess 対策として空文字へフォールバックする(実際には到達しない)。
  const weekday = time.weekdayShort[new Date(Date.UTC(year, month - 1, day)).getUTCDay()] ?? "";
  return time.dateLabel(month, day, weekday);
}

/**
 * 分数 → "○日○時間(○分)"相当(有給残高の表示用、v0.3)。
 * standardDayMinutes(所定労働時間)で日に換算し、余りを時間・分に分解する。
 * standardDayMinutes が 0 以下の場合は換算できないため分のみを返す(防御的フォールバック)。
 * 単位・区切りはロケールごとに異なる(例: 英語は "3d 2h 15m" のようにスペース区切り)。
 */
export function formatDaysHoursMinutes(minutes: number, standardDayMinutes: number): string {
  const time = getMessages().time;
  const total = Math.max(0, Math.round(minutes));
  if (standardDayMinutes <= 0) return `${total}${time.unitMinute}`;

  const days = Math.floor(total / standardDayMinutes);
  const remainder = total % standardDayMinutes;
  const hours = Math.floor(remainder / 60);
  const mins = remainder % 60;

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}${time.unitDay}`);
  if (hours > 0 || days === 0) parts.push(`${hours}${time.unitHour}`);
  if (mins > 0) parts.push(`${mins}${time.unitMinute}`);
  return parts.join(time.durationJoin);
}
