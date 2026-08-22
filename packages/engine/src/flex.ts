/**
 * フレックス集計(docs/design/v01-data-model.md「集計エンジンの入出力」、
 * および要件定義書 §2「v0.1のフレックス仕様」)。
 *
 * 清算期間1ヶ月・コアタイムなし。月枠 = floor(週法定労働時間 × 暦日数 / 7)。
 * 週法定労働時間・60時間超区分の有効/閾値は `@kizami/law` の `LawRules` から取得する
 * (原則 週40時間・月60時間だが、特例措置対象事業場は週44時間、60時間超区分は
 * 施行日より前は無効 — packages/law/README.md 参照)。
 *
 * 判断点: フレックスの月枠・60時間超閾値は「月」単位でしか意味を持たない値であり、
 * `daily.ts` の深夜帯のように「日ごと」に解決する対象ではない。本関数は期間初日
 * (`period` の1日)に有効な法令版を1つだけ解決し、月全体に適用する
 * (月の途中で法令が切り替わる稀なケースは、深夜帯のような日次カテゴリでのみ日ごとに
 * 反映され、月次集計であるフレックス総枠・60時間超閾値は初日基準で決め打ちにする)。
 */

import { daysInMonth, findLawForDate, formatDateString, isInPeriod } from "./date.js";
import type { CategorizedMinutes, DailyBreakdown, FlexBalance, LawTimelineSpan, PaidLeaveEntry, SettingsSpan } from "./types.js";

export function calculateFlexBalance(
  days: DailyBreakdown[],
  settingsTimeline: SettingsSpan[],
  lawTimeline: LawTimelineSpan[],
  period: { year: number; month: number },
  paidLeave: PaidLeaveEntry[],
): { totals: CategorizedMinutes; flexBalance: FlexBalance } {
  const dim = daysInMonth(period.year, period.month);
  const periodStartDate = formatDateString({ year: period.year, month: period.month, day: 1 });

  // 総枠は「日々の積み上げ」なので日割りで按分する。期間の途中で週法定労働時間が変わる
  // 改正(例: 特例措置の見直し)があっても、その日から新しい値が効く。
  // 週法定が期間を通じて一定なら floor(週法定 × 暦日数 / 7) と一致する。
  //
  // 一方で「閾値」(60時間超の区分、36協定の月/年上限)は期間全体に対する一つの数値であり
  // 按分できないため、期間開始日の版を使う(下記 law)。判断の基準日については
  // docs/design/v01-data-model.md「法令の適用時点」を参照。
  // 日ごとに 7 で割ると浮動小数の誤差が累積して1分ずれることがあるため、
  // 週法定労働時間(整数)を合計してから最後に一度だけ 7 で割る。
  let weeklyMinutesSum = 0;
  for (let day = 1; day <= dim; day++) {
    const date = formatDateString({ year: period.year, month: period.month, day });
    weeklyMinutesSum += findLawForDate(date, lawTimeline).weeklyStatutoryMinutes;
  }
  const frameMinutes = Math.floor(weeklyMinutesSum / 7);

  const law = findLawForDate(periodStartDate, lawTimeline);

  const workedTotal = days.reduce((sum, d) => sum + d.workedMinutes, 0);
  const paidLeaveMinutesInPeriod = paidLeave
    .filter((entry) => isInPeriod(entry.date, period))
    .reduce((sum, entry) => sum + entry.minutes, 0);
  const actualMinutes = workedTotal + paidLeaveMinutesInPeriod;

  const statutory = Math.min(actualMinutes, frameMinutes);
  const overtime = Math.max(0, actualMinutes - frameMinutes);
  // 60時間超区分が無効な期間(2010年以前・中小企業の2023年3月以前)は overtime60h を常に0にする
  const overtime60h = law.overtime60h.enabled ? Math.max(0, overtime - law.overtime60h.thresholdMinutes) : 0;
  const lateNight = days.reduce((sum, d) => sum + d.lateNightMinutes, 0);
  const statutoryHoliday = days.reduce((sum, d) => sum + d.legalHolidayMinutes, 0);

  const diffMinutes = actualMinutes - frameMinutes;

  return {
    totals: { statutory, overtime, overtime60h, lateNight, statutoryHoliday },
    flexBalance: { frameMinutes, actualMinutes, diffMinutes },
  };
}
