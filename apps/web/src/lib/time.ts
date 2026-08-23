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
 *
 * 内部実装(2026-08 Temporal 導入): 暦計算そのものは `Temporal.PlainDate` /
 * `PlainDateTime` / `Instant`(lib/temporal.ts 経由)に寄せている。公開シグネチャ(エポック分
 * = number, 暦日 = "YYYY-MM-DD" 文字列)は変えていない。JST はここでは "+09:00" の固定オフセット
 * time zone として Temporal に渡す(Temporal.TimeZone に "Asia/Tokyo" 等の IANA 名を使う切替は
 * タイムゾーン設定対応時の将来対応)。
 */
import { getMessages } from "./i18n";
import { Temporal, type TemporalInstant, type TemporalPlainDate, type TemporalZonedDateTime } from "./temporal";

const JST_TIME_ZONE = "+09:00";
const MINUTES_PER_DAY = 1440;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^(\d{2}):(\d{2})$/;

function epochMinutesFromInstant(instant: TemporalInstant): number {
  return Math.floor(instant.epochMilliseconds / 60_000);
}

function instantFromEpochMinutes(minutes: number): TemporalInstant {
  return Temporal.Instant.fromEpochMilliseconds(minutes * 60_000);
}

/** UTC エポック分 → JST の ZonedDateTime。 */
function jstZonedDateTimeFromEpochMinutes(minutes: number): TemporalZonedDateTime {
  return instantFromEpochMinutes(minutes).toZonedDateTimeISO(JST_TIME_ZONE);
}

/**
 * "YYYY-MM-DD" を厳密にパースする(旧実装の `/^(\d{4})-(\d{2})-(\d{2})$/` と同じ形式のみ許容)。
 * `Temporal.PlainDate.from` はこの正規表現より緩い ISO 表記(タイムゾーン注記付き等)も
 * 受け付けてしまうため、まず旧実装と同じ形式チェックをかけてから渡す。
 */
function parsePlainDateStrict(dateStr: string): TemporalPlainDate | null {
  if (!DATE_RE.test(dateStr)) return null;
  return Temporal.PlainDate.from(dateStr);
}

/** UTC エポック分(整数)。 */
export function nowMinutes(epochMs: number = Date.now()): number {
  return epochMinutesFromInstant(Temporal.Instant.fromEpochMilliseconds(epochMs));
}

/** JST の「今日」の [dayStart, dayEnd] を UTC エポック分(inclusive)で返す。 */
export function jstTodayWindow(epochMs: number = Date.now()): { from: number; to: number } {
  const zdt = Temporal.Instant.fromEpochMilliseconds(epochMs).toZonedDateTimeISO(JST_TIME_ZONE);
  const dayStart = zdt.toPlainDate().toZonedDateTime(JST_TIME_ZONE);
  const from = epochMinutesFromInstant(dayStart.toInstant());
  return { from, to: from + MINUTES_PER_DAY - 1 };
}

/** UTC エポック分 → JST "HH:mm"。 */
export function formatTimeJst(occurredAtMinutes: number): string {
  const zdt = jstZonedDateTimeFromEpochMinutes(occurredAtMinutes);
  return `${String(zdt.hour).padStart(2, "0")}:${String(zdt.minute).padStart(2, "0")}`;
}

/** "YYYY-MM-DD" の JST 日窓を UTC エポック分(inclusive)で返す(jstTodayWindow の任意日付版)。 */
export function dateWindowJst(dateStr: string): { from: number; to: number } {
  const plainDate = parsePlainDateStrict(dateStr);
  if (!plainDate) {
    throw new Error(`dateWindowJst: invalid date "${dateStr}"`);
  }
  const from = epochMinutesFromInstant(plainDate.toZonedDateTime(JST_TIME_ZONE).toInstant());
  return { from, to: from + MINUTES_PER_DAY - 1 };
}

/** "YYYY-MM-DD" + "HH:mm"(input type="time" の値)→ UTC エポック分。不正な形式は null。 */
export function toEpochMinutesJst(dateStr: string, hhmm: string): number | null {
  const plainDate = parsePlainDateStrict(dateStr);
  const timeMatch = TIME_RE.exec(hhmm);
  if (!plainDate || !timeMatch) return null;
  const [, hh, mm] = timeMatch;
  const plainDateTime = plainDate.toPlainDateTime({ hour: Number(hh), minute: Number(mm) });
  return epochMinutesFromInstant(plainDateTime.toZonedDateTime(JST_TIME_ZONE).toInstant());
}

/** UTC エポック分 → JST "YYYY-MM-DD"。 */
export function dateStrFromEpochMinutesJst(minutes: number): string {
  return jstZonedDateTimeFromEpochMinutes(minutes).toPlainDate().toString();
}

/** UTC エポック分 → JST "M/D(曜) HH:mm"(申請一覧の対象日時表示用)。 */
export function formatDateTimeJst(minutes: number): string {
  return `${formatDateLabel(dateStrFromEpochMinutesJst(minutes))} ${formatTimeJst(minutes)}`;
}

/** JST の暦日 "YYYY-MM-DD" 同士の日数差(b - a)。月次一覧の「翌」判定に使う。 */
export function diffCalendarDaysJst(aDateStr: string, bDateStr: string): number {
  const a = Temporal.PlainDate.from(aDateStr);
  const b = Temporal.PlainDate.from(bDateStr);
  return a.until(b, { largestUnit: "day" }).days;
}

/** "YYYY-MM-DD" → "M/D"(曜日なし)。日をまたいだ退勤時刻の表示など、短く日付だけ示したい場面用。 */
export function formatMonthDayShort(dateStr: string): string {
  const date = Temporal.PlainDate.from(dateStr);
  return `${date.month}/${date.day}`;
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
  const zdt = Temporal.Instant.fromEpochMilliseconds(epochMs).toZonedDateTimeISO(JST_TIME_ZONE);
  return { year: zdt.year, month: zdt.month };
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
  const shifted = Temporal.PlainYearMonth.from({ year, month }).add({ months: delta });
  return { year: shifted.year, month: shifted.month };
}

export function formatMonthLabel({ year, month }: YearMonth): string {
  return getMessages().time.monthLabel(year, month);
}

/** "YYYY-MM-DD" → "M/D(曜)"(ロケールごとの曜日表記・並びは lib/i18n の各辞書 time.* が持つ)。 */
export function formatDateLabel(dateStr: string): string {
  const date = Temporal.PlainDate.from(dateStr);
  const time = getMessages().time;
  // Temporal.PlainDate#dayOfWeek は ISO 準拠で 1(月)〜7(日)を返す。旧実装の
  // Date#getUTCDay()(0=日〜6=土、weekdayShort の添字と同じ並び)に合わせるため %7 で変換する
  // (7%7=0 で日曜が 0 になる)。noUncheckedIndexedAccess 対策の `?? ""` は実際には到達しない。
  const weekday = time.weekdayShort[date.dayOfWeek % 7] ?? "";
  return time.dateLabel(date.month, date.day, weekday);
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
