/**
 * KIZAMI 集計エンジン
 *
 * 制約(要件 §8/§9):
 * - 純関数のみ。I/O・Date.now()・タイムゾーン暗黙依存を持たない
 * - Node と workerd の両方で同一に動作する
 * - 入力は打刻列+テナント設定、出力は区分別時間数(分単位)
 *
 * 労働時間制の分岐(判断点): どの労働時間制で計算するかは「期間開始日(period の1日)」に
 * 有効な `workSystem.kind` だけで決める(flex.ts が月枠の閾値系の値を期間開始日基準で
 * 決め打ちにしているのと同じ流儀)。期間の途中で `workSystem.kind` が切り替わる設定変更が
 * あった場合、日ごとに集計方式を切り替えるのではなく `mixed_work_system` 警告を1件出したうえで
 * 期間開始日の版のまま最後まで計算する — 「月の途中でフレックス⇔固定が切り替わる」こと自体が
 * 制度上まれで、切替の日割り計算(フレックスの清算期間の扱いなど)は本パッケージのスコープ外。
 */
import { checkBreakSufficiency } from "./break-check.js";
import { findSettingsForDate, formatDateString } from "./date.js";
import { buildDailyBreakdown } from "./daily.js";
import { deriveSegments } from "./derive.js";
import { calculateFixedTotals } from "./fixed.js";
import { calculateFlexBalance } from "./flex.js";
import type { CalcWarning, EngineInput, EngineOutput } from "./types.js";

export type * from "./types.js";

export function calculate(input: EngineInput): EngineOutput {
  const { workedSegments, breakSegments, warnings, stretches } = deriveSegments(
    input.punches,
    input.settingsTimeline,
  );

  const days = buildDailyBreakdown(
    workedSegments,
    breakSegments,
    input.settingsTimeline,
    input.lawTimeline,
    input.period,
    input.paidLeave,
    stretches,
  );

  // 休憩不足(labor law §34-1)は打刻列の解釈(deriveSegments)とは独立な判定であり、
  // 確定した stretches(workedMinutes/breakMinutes 込み)に対して行う。
  const breakWarnings = checkBreakSufficiency(stretches, input.settingsTimeline, input.lawTimeline, input.period);

  const periodStartDate = formatDateString({ year: input.period.year, month: input.period.month, day: 1 });
  const workSystemKind = findSettingsForDate(periodStartDate, input.settingsTimeline).workSystem.kind;

  // 期間内のいずれかの日で、期間開始日と異なる労働時間制が有効なら mixed_work_system を発する
  const isMixedWorkSystem = days.some(
    (day) => findSettingsForDate(day.date, input.settingsTimeline).workSystem.kind !== workSystemKind,
  );
  const mixedWarning: CalcWarning[] = isMixedWorkSystem
    ? [{ kind: "mixed_work_system", date: periodStartDate }]
    : [];

  // 警告の合流順序(判断点): 打刻列そのものの解釈に関わる warnings(粒度: 個々の打刻) →
  // 休憩不足 breakWarnings(粒度: 勤務区間) → mixed_work_system(粒度: 期間全体)の順に並べる。
  // UI は日付でグルーピングして表示するため、この配列内の順序自体は表示結果を左右しない
  // (どちらの並びでも動きは同じ)。ここでは「対象範囲が狭いものから広いものへ」という
  // 発生源の粒度で揃えることを優先し、日付でのソートはあえて行わない
  // (ソートすると同日内で warningKind ごとの安定した順序を新たに決める必要が生まれ、
  // 得られる価値(表示上の見た目)に対してコストが見合わないと判断した)。
  if (workSystemKind === "fixed") {
    const { totals, days: fixedDays } = calculateFixedTotals(
      days,
      input.settingsTimeline,
      input.lawTimeline,
      input.period,
      input.paidLeave,
    );
    return {
      days: fixedDays,
      totals,
      flexBalance: null,
      workSystem: "fixed",
      warnings: [...warnings, ...breakWarnings, ...mixedWarning],
    };
  }

  const { totals, flexBalance } = calculateFlexBalance(
    days,
    input.settingsTimeline,
    input.lawTimeline,
    input.period,
    input.paidLeave,
  );
  return {
    days,
    totals,
    flexBalance,
    workSystem: "flex",
    warnings: [...warnings, ...breakWarnings, ...mixedWarning],
  };
}
