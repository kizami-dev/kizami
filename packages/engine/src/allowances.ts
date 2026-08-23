/**
 * 手当対象時間の算出(docs/design/allowances.md)。
 *
 * 実労働セグメント(休憩・自動控除の控除後 = index.ts が buildDailyBreakdown に渡すのと
 * 同じ workedSegments)を勤怠日の窓で分割し(daily.ts の splitByAttendanceDay を再利用)、
 * 各手当定義の条件(dates/weekdays/timeBand の AND)との重なりを分単位で積算する —
 * lateNightMinutes(深夜帯の日別配賦)と同じ流儀。
 *
 * - 帰属は「そのセグメントが属する勤怠日」の日付で行う(splitByAttendanceDay が既に
 *   その日付で区切ってくれるので、以降の条件判定はすべて piece.date を基準にする)
 * - 有給は算入しない: 有給(paidLeave)は打刻由来のセグメントを持たないため、workedSegments
 *   だけを走査する本モジュールは何もしなくても有給時間を対象外にできる
 *   (paidLeave 配列を引数に取らないのはこのため — 取る意味がない)
 * - 法定休日の労働は算入する: daily.ts は「法定休日は DailyBreakdown.workedMinutes を 0 にする」
 *   処理を行うが、それは daily.ts 内で別途 zero out しているだけで、ここで受け取る
 *   workedSegments 自体(index.ts から渡される生のセグメント)には法定休日の実労働もそのまま
 *   含まれている。lateNightMinutes が法定休日分を含むのと同じ理由・同じ実装パターン
 */

import { splitByAttendanceDay } from "./daily.js";
import { epochDayFromDateString, findSettingsForDate, isInPeriod, timeBandOverlapMinutes, weekdayFromEpochDay } from "./date.js";
import type { Segment } from "./derive.js";
import type { AllowanceDefinition, AllowanceTimelineSpan, PlainDateString, SettingsSpan } from "./types.js";

/**
 * timeline(from 昇順を仮定しない)から、指定ローカル日付に有効な手当定義を全部返す。
 * 定義(`definition.id`)ごとに独立した版の系列として扱い、各系列で `from <= date` の
 * 最新版を1つ選ぶ(findSettingsForDate と同じ解決方法を、定義の数だけ並行に行うイメージ)。
 */
export function resolveAllowanceDefinitionsForDate(
  date: PlainDateString,
  timeline: AllowanceTimelineSpan[],
): AllowanceDefinition[] {
  const chosen = new Map<string, AllowanceTimelineSpan>();
  for (const span of timeline) {
    if (span.from > date) continue;
    const current = chosen.get(span.definition.id);
    if (!current || span.from > current.from) {
      chosen.set(span.definition.id, span);
    }
  }
  return [...chosen.values()].map((span) => span.definition);
}

/**
 * `date` が `patterns` のいずれかに一致するか。"YYYY-MM-DD" は完全一致(固定日付)、
 * "--MM-DD" は年を無視して月日部分だけ一致すれば良い(毎年発生)。
 */
function dateMatches(date: PlainDateString, patterns: PlainDateString[]): boolean {
  const monthDay = date.slice(5); // date は "YYYY-MM-DD" 前提。"MM-DD" 部分を取り出す
  return patterns.some((pattern) => (pattern.startsWith("--") ? pattern.slice(2) === monthDay : pattern === date));
}

/** 1つの手当定義の条件が、勤怠日 `date` と時間帯 [pieceStart, pieceEnd) に対して許可する分数 */
function overlapMinutesForDefinition(
  definition: AllowanceDefinition,
  date: PlainDateString,
  weekday: 0 | 1 | 2 | 3 | 4 | 5 | 6,
  pieceStart: number,
  pieceEnd: number,
  tzOffsetMinutes: number,
): number {
  const { conditions } = definition;
  if (conditions.dates && !dateMatches(date, conditions.dates)) return 0;
  if (conditions.weekdays && !conditions.weekdays.includes(weekday)) return 0;
  // timeBand 省略時は「終日」— この piece は既に splitByAttendanceDay で勤怠日の窓に
  // 収まっているので、そのままの長さを対象時間として扱えばよい
  if (!conditions.timeBand) return pieceEnd - pieceStart;
  return timeBandOverlapMinutes(pieceStart, pieceEnd, tzOffsetMinutes, conditions.timeBand);
}

/**
 * 実労働セグメントと各手当定義の条件との重なりを勤怠日別・定義別に算出する。
 * 返り値: 勤怠日 → (定義ID → 分数)。0分になった組み合わせは含めない(sparse)。
 *
 * `period` で期間外の日を除外する(daily.ts の isInPeriod フィルタと同じ — 月またぎの
 * 夜勤セグメントが前月/翌月の勤怠日に配賦された分を、この月の集計に含めないため)。
 */
export function computeAllowanceMinutesByDate(
  workedSegments: Segment[],
  settingsTimeline: SettingsSpan[],
  timeline: AllowanceTimelineSpan[],
  period: { year: number; month: number },
): Map<PlainDateString, Map<string, number>> {
  const byDate = new Map<PlainDateString, Map<string, number>>();
  if (timeline.length === 0) return byDate;

  for (const segment of workedSegments) {
    for (const piece of splitByAttendanceDay(segment, settingsTimeline)) {
      if (!isInPeriod(piece.date, period)) continue;
      const definitions = resolveAllowanceDefinitionsForDate(piece.date, timeline);
      if (definitions.length === 0) continue;

      const settings = findSettingsForDate(piece.date, settingsTimeline);
      const weekday = weekdayFromEpochDay(epochDayFromDateString(piece.date));

      for (const definition of definitions) {
        const minutes = overlapMinutesForDefinition(
          definition,
          piece.date,
          weekday,
          piece.start,
          piece.end,
          settings.tzOffsetMinutes,
        );
        if (minutes <= 0) continue;
        const dateMap = byDate.get(piece.date) ?? new Map<string, number>();
        dateMap.set(definition.id, (dateMap.get(definition.id) ?? 0) + minutes);
        byDate.set(piece.date, dateMap);
      }
    }
  }
  return byDate;
}
