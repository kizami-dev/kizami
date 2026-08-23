/**
 * 日付演算(Temporal ベース、第5波)。
 *
 * - civil date (year/month/day) ⇔ epoch日の変換は Temporal.PlainDate に委譲する。
 *   Temporal は既定で ISO 8601(= proleptic Gregorian)暦を使うため、旧実装
 *   (Howard Hinnant の civil calendar アルゴリズム, http://howardhinnant.github.io/date_algorithms.html)
 *   と暦モデルは完全に一致する。
 * - 曜日は epoch日から算出。1970-01-01 (epoch日 0) = 木曜 = 4 (この対応は変えていない)
 * - ローカル分 = UTCエポック分 + tzOffsetMinutes(原則5, types.ts コメント)
 * - 「[start,end) UTC エポック分の区間と暦時刻の帯との重なり分数」を求める部分
 *   (timeBandOverlapMinutes 等)は、暦の年月日そのものではなく「エポック分」の単純な
 *   整数演算(Math.floor・剰余)で完結しており、Temporal を挟む意味がない
 *   (暦の閏年・月末日数のような "civil calendar 特有の癖" が一切絡まない)うえ、
 *   セグメント×日のループで呼ばれるホットパスでもあるため、あえて Temporal 化していない。
 * - Date オブジェクト・Date.now()・Temporal.Now は一切使わない(要件 §8/§9:
 *   純関数・現在時刻非依存。エンジンへの入力に現在時刻はそもそも存在しない)。
 */

import { Temporal } from "./lib/temporal.js";
import type { CalcSettings, LawTimelineSpan, LegalHolidayRule, PlainDateString, SettingsSpan } from "./types.js";

export interface CivilDate {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
}

const MINUTES_PER_DAY = 1440;

/** epoch日の基準点(1970-01-01 = epoch日 0)。全ての epoch日⇔暦日変換はここからの相対日数。 */
const EPOCH = Temporal.PlainDate.from("1970-01-01");

type PlainDate = InstanceType<typeof Temporal.PlainDate>;

/**
 * epoch日 → Temporal.PlainDate のメモ化キャッシュ。
 *
 * resolveAttendanceDate は打刻1件ごとに(最大2パス)呼ばれ、内部で
 * civilFromDays(≒このキャッシュ)を経由する。月次集計はユーザー×日×セグメントの
 * ループで打刻数ぶん呼ばれうるが、同一 epoch日への変換を使い回すことで
 * Temporal.PlainDate の生成コストを「処理した打刻数」ではなく「処理した日数」の
 * オーダーに抑える(1テナント1ヶ月あたり高々数十件)。プロセス生存期間中に扱った
 * 日数ぶんだけ単調に増えるが、実用上問題にならない規模のため明示的な破棄はしていない。
 */
const plainDateByEpochDay = new Map<number, PlainDate>();

function plainDateFromEpochDay(epochDay: number): PlainDate {
  const cached = plainDateByEpochDay.get(epochDay);
  if (cached) return cached;
  const pd = EPOCH.add({ days: epochDay });
  plainDateByEpochDay.set(epochDay, pd);
  return pd;
}

/** civil date (proleptic Gregorian) → epoch日数(1970-01-01 = 0) */
export function daysFromCivil(year: number, month: number, day: number): number {
  // overflow: "reject" — 存在しない日付(例: 2月30日)は例外にする。呼び出し元はすべて
  // 「有効な暦日である」ことが確定した year/month/day のみを渡す(第5波の棚卸しで確認済み。
  // 特に daysInMonth は day=1 固定で呼ぶため常に安全)。
  const pd = Temporal.PlainDate.from({ year, month, day }, { overflow: "reject" });
  return EPOCH.until(pd, { largestUnit: "day" }).days;
}

/** epoch日数 → civil date */
export function civilFromDays(z: number): CivilDate {
  const pd = plainDateFromEpochDay(z);
  return { year: pd.year, month: pd.month, day: pd.day };
}

/** 曜日: 0=日曜 ... 6=土曜。epoch日 0 (1970-01-01) は木曜(4)。 */
export function weekdayFromEpochDay(epochDay: number): 0 | 1 | 2 | 3 | 4 | 5 | 6 {
  const pd = plainDateFromEpochDay(epochDay);
  // Temporal.PlainDate#dayOfWeek は 1=月曜...7=日曜。%7 で 0=日曜...6=土曜(JS Date#getDay と
  // 同じ並び)に変換する。この対応を変えると fixed.ts の週起算の剰余演算
  // ((weekday - weekStartWeekday + 7) % 7) が壊れるため固定。
  return (pd.dayOfWeek % 7) as 0 | 1 | 2 | 3 | 4 | 5 | 6;
}

export function parseDateString(date: PlainDateString): CivilDate {
  // Temporal.PlainDate.from の文字列パースは overflow オプションに関わらず常に厳格
  // (存在しない日付・不正な形式は RangeError で throw する)。旧実装は Number() で
  // 分解するだけで妥当性を検証しない寛容な実装だったが、fixtures・テストのいずれも
  // 不正な日付文字列のロールオーバーに依存していないことを第5波の棚卸しで確認済み。
  const pd = Temporal.PlainDate.from(date);
  return { year: pd.year, month: pd.month, day: pd.day };
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

/** "YYYY-MM-DD" → epoch日。同一文字列に対する変換はメモ化する(理由は plainDateByEpochDay 参照)。 */
const epochDayByDateString = new Map<PlainDateString, number>();

export function epochDayFromDateString(date: PlainDateString): number {
  const cached = epochDayByDateString.get(date);
  if (cached !== undefined) return cached;
  const civil = parseDateString(date);
  const epochDay = daysFromCivil(civil.year, civil.month, civil.day);
  epochDayByDateString.set(date, epochDay);
  return epochDay;
}

/** 指定 civil month の暦日数 */
export function daysInMonth(year: number, month: number): number {
  return Temporal.PlainDate.from({ year, month, day: 1 }).daysInMonth;
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

/** timeline(from 昇順を仮定しない)から、指定ローカル日付に有効な最新版の法令ルールを返す(findSettingsForDate と同じ解決方法)。 */
export function findLawForDate(date: PlainDateString, timeline: LawTimelineSpan[]): LawTimelineSpan["law"] {
  let chosen: LawTimelineSpan | undefined;
  for (const span of timeline) {
    if (span.from <= date && (chosen === undefined || span.from > chosen.from)) {
      chosen = span;
    }
  }
  if (!chosen) {
    throw new Error(`no law version effective on or before ${date}`);
  }
  return chosen.law;
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
 * [start, end) UTC エポック分の区間と、暦時刻の帯(ローカル、日ごと、`band` で指定)との
 * 重なり分数。深夜帯(lateNightOverlapMinutes)・手当の時間帯条件(allowances.ts)の両方が
 * この関数を使う共通実装。
 *
 * `lateNight`(法令由来)は常に日をまたぐ(startMinutes > endMinutes)前提だったが、手当の
 * timeBand は日をまたがない帯(6:00〜8:00 のように startMinutes < endMinutes)も許容する
 * (docs/design/allowances.md)ため、両方を正しく扱えるよう分岐する:
 * - startMinutes < endMinutes(日をまたがない): 各暦日 d について単純に [startMinutes,endMinutes)
 *   との重なりを積算する
 * - startMinutes > endMinutes(日をまたぐ、22:00〜翌5:00 等): 各暦日 d について
 *   「d の [startMinutes,1440) 部分」と「d の [0,endMinutes) 部分」の両方を独立に積算する
 *   (= d 自身の夜と d 自身の未明であり、d の夜〜d+1 の未明を1つの連続区間として扱うわけではない。
 *   この積算方式で日跨ぎシフトの深夜時間が正しく求まることは late-night-day-boundary.yaml で固定)
 * - startMinutes === endMinutes: 長さ0の帯として扱い、常に0を返す
 *
 * (この2分岐を1つの式にまとめようとして [startMinutes,1440) ∪ [0,endMinutes) を単純に
 * 両方積算すると、日をまたがない帯では実質「終日」と等価になってしまう誤りがあったため、
 * 明示的に分岐している)
 */
export function timeBandOverlapMinutes(
  start: number,
  end: number,
  tzOffsetMinutes: number,
  band: { startMinutes: number; endMinutes: number },
): number {
  if (end <= start || band.startMinutes === band.endMinutes) return 0;
  const localStart = start + tzOffsetMinutes;
  const localEnd = end + tzOffsetMinutes;
  const firstDay = Math.floor(localStart / MINUTES_PER_DAY);
  const lastDay = Math.floor((localEnd - 1) / MINUTES_PER_DAY);
  let total = 0;
  const crossesMidnight = band.startMinutes > band.endMinutes;
  for (let d = firstDay; d <= lastDay; d++) {
    const base = d * MINUTES_PER_DAY;
    if (crossesMidnight) {
      total += rangeOverlap(localStart, localEnd, base + band.startMinutes, base + MINUTES_PER_DAY);
      total += rangeOverlap(localStart, localEnd, base + 0, base + band.endMinutes);
    } else {
      total += rangeOverlap(localStart, localEnd, base + band.startMinutes, base + band.endMinutes);
    }
  }
  return total;
}

/**
 * [start, end) UTC エポック分の区間と、暦時刻の深夜帯(ローカル、日ごと、`lateNight` で指定)
 * との重なり分数。`lateNight`(法令由来、`@kizami/law` の `LawRules["lateNight"]`)は日をまたぐ
 * 表現(startMinutes > endMinutes)を前提にしている(2000年基準版から現在まで実際にそうなって
 * いるため)。実装は timeBandOverlapMinutes に委譲(手当の時間帯条件と同じ計算)。
 */
export function lateNightOverlapMinutes(
  start: number,
  end: number,
  tzOffsetMinutes: number,
  lateNight: { startMinutes: number; endMinutes: number },
): number {
  return timeBandOverlapMinutes(start, end, tzOffsetMinutes, lateNight);
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
