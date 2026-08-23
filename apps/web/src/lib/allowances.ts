/**
 * 手当定義の条件(AllowanceConditionsDto)を人間可読な要約文字列にする(docs/design/allowances.md、
 * 2026-08-23 追加)。
 *
 * 設定画面(SettingsAllowancesView)の一覧・履歴表示で使う。
 *
 * 判断点(完了報告に明記): 依頼は「この要約関数は月次でも使うので lib に置く」としているが、
 * GET /attendance/monthly は手当の条件そのものを返さない(definitionId→name のマップのみ、
 * apps/api/src/lib/allowances.ts の buildAllowanceNameMap 参照 — 表示用に「今この手当が
 * 何と呼ばれているか」だけを解決するための構造で、conditions は含めない設計になっている)。
 * そのため MonthlyView は実際にはこの関数を呼ばず「名前+分数」だけを表示する。lib に置くのは
 * 依頼の指示に沿った将来の共通化への備え(API 側が条件を返すよう拡張されれば月次からも
 * そのまま呼べる)。
 */
import type { AllowanceConditionsDto } from "./api";
import { messages } from "./messages";

/** 分(0〜1439) → "HH:MM"。SettingsAttendanceView の同名ヘルパーと同じ形式(既存方針どおりファイルごとに小さく再実装)。 */
function minutesOfDayToHm(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h < 10 ? `0${h}` : h}:${m < 10 ? `0${m}` : m}`;
}

/** "--MM-DD" の "MM-DD" 部分 → 2001年(平年、うるう年の影響を避けるための固定参照年)を基準にした通し日数。連続レンジのグルーピングに使う。 */
function yearlyDayIndex(monthDay: string): number {
  const [month, day] = monthDay.split("-").map(Number);
  return Date.UTC(2001, (month ?? 1) - 1, day ?? 1) / 86_400_000;
}

function formatYearlyMonthDay(monthDay: string): string {
  const [month, day] = monthDay.split("-").map(Number);
  return `${month}/${day}`;
}

function formatFixedDate(date: string): string {
  const [, month, day] = date.split("-").map(Number);
  return `${month}/${day}`;
}

function epochDayFromIsoDate(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y ?? 0, (m ?? 1) - 1, d ?? 1) / 86_400_000;
}

interface DateRun<T> {
  items: { key: T; idx: number }[];
}

/** idx 昇順に並べた要素を、連続する idx(差が1)ごとのレンジへまとめる。 */
function groupConsecutive<T>(entries: { key: T; idx: number }[]): DateRun<T>[] {
  const sorted = [...entries].sort((a, b) => a.idx - b.idx);
  const runs: DateRun<T>[] = [];
  for (const entry of sorted) {
    const last = runs[runs.length - 1];
    const prevIdx = last ? last.items[last.items.length - 1]?.idx : undefined;
    if (last && prevIdx !== undefined && entry.idx - prevIdx === 1) {
      last.items.push(entry);
    } else {
      runs.push({ items: [entry] });
    }
  }
  return runs;
}

/**
 * "--MM-DD" のリスト("--" を除いた "MM-DD" 部分)を「毎年 12/31〜1/3」のようなレンジ表記へまとめる。
 * 年またぎ(12/31 と 1/1 が連続)も1レンジにまとめる(年末年始手当のような典型例のため)。
 */
function summarizeYearlyDates(monthDays: string[]): string {
  const sep = messages.settingsAllowances.summaryDateRangeSeparator;
  const listSep = messages.settingsAllowances.summaryListSeparator;
  const unique = [...new Set(monthDays)];
  const runs = groupConsecutive(unique.map((md) => ({ key: md, idx: yearlyDayIndex(md) })));

  if (runs.length > 1) {
    const firstRun = runs[0];
    const lastRun = runs[runs.length - 1];
    const startsAtJan1 = firstRun?.items[0]?.key === "01-01";
    const lastRunLastItem = lastRun ? lastRun.items[lastRun.items.length - 1] : undefined;
    const endsAtDec31 = lastRunLastItem?.key === "12-31";
    if (firstRun && lastRun && startsAtJan1 && endsAtDec31) {
      const merged: DateRun<string> = { items: [...lastRun.items, ...firstRun.items] };
      runs.pop();
      runs.shift();
      runs.push(merged);
    }
  }

  return runs
    .map((run) => {
      const start = run.items[0]?.key ?? "";
      const end = run.items[run.items.length - 1]?.key ?? "";
      return start === end ? formatYearlyMonthDay(start) : `${formatYearlyMonthDay(start)}${sep}${formatYearlyMonthDay(end)}`;
    })
    .join(listSep);
}

/** "YYYY-MM-DD" のリストを「4/29〜5/5」のようなレンジ表記へまとめる(暦をまたぐ月の連続にも対応)。 */
function summarizeFixedDates(dates: string[]): string {
  const sep = messages.settingsAllowances.summaryDateRangeSeparator;
  const listSep = messages.settingsAllowances.summaryListSeparator;
  const unique = [...new Set(dates)];
  const runs = groupConsecutive(unique.map((d) => ({ key: d, idx: epochDayFromIsoDate(d) })));

  return runs
    .map((run) => {
      const start = run.items[0]?.key ?? "";
      const end = run.items[run.items.length - 1]?.key ?? "";
      return start === end ? formatFixedDate(start) : `${formatFixedDate(start)}${sep}${formatFixedDate(end)}`;
    })
    .join(listSep);
}

/**
 * 手当定義の条件(AND 条件)を1つの要約文字列にする。
 * 例: dates=["--12-31","--01-01","--01-02","--01-03"], timeBand={22:00〜5:00}
 *     → "毎年 12/31〜1/3 の 22:00〜翌5:00"
 */
export function summarizeAllowanceConditions(conditions: AllowanceConditionsDto): string {
  const m = messages.settingsAllowances;
  const parts: string[] = [];

  if (conditions.dates && conditions.dates.length > 0) {
    const yearly = conditions.dates.filter((d) => d.startsWith("--")).map((d) => d.slice(2));
    const fixed = conditions.dates.filter((d) => !d.startsWith("--"));
    const dateParts: string[] = [];
    if (yearly.length > 0) dateParts.push(`${m.summaryYearlyPrefix}${summarizeYearlyDates(yearly)}`);
    if (fixed.length > 0) dateParts.push(summarizeFixedDates(fixed));
    parts.push(dateParts.join(m.summaryListSeparator));
  }

  if (conditions.weekdays && conditions.weekdays.length > 0) {
    const labels = [...conditions.weekdays].sort((a, b) => a - b).map((w) => messages.settingsAttendance.weekdayLabel[w]);
    parts.push(labels.join(m.summaryListSeparator));
  }

  if (conditions.timeBand) {
    const { startMinutes, endMinutes } = conditions.timeBand;
    const startLabel = minutesOfDayToHm(startMinutes);
    const endLabel = startMinutes >= endMinutes ? `${m.summaryNextDayPrefix}${minutesOfDayToHm(endMinutes)}` : minutesOfDayToHm(endMinutes);
    parts.push(`${startLabel}${m.summaryDateRangeSeparator}${endLabel}`);
  }

  return parts.join(m.summaryPartsSeparator);
}
