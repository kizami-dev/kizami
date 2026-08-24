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
import { computeAllowanceMinutesByDate, resolveAllowanceDefinitionsForDate } from "./allowances.js";
import { applyAutoBreakDeduction } from "./auto-break.js";
import { checkBreakSufficiency } from "./break-check.js";
import { computeCoreTimeWarnings } from "./core-time.js";
import { findSettingsForDate, formatDateString } from "./date.js";
import { buildDailyBreakdown } from "./daily.js";
import { deriveSegments } from "./derive.js";
import { calculateFixedTotals } from "./fixed.js";
import { calculateFlexBalance } from "./flex.js";
import { computeShiftVarianceWarnings } from "./shift-variance.js";
import { calculateVariableTotals } from "./variable.js";
import type { CalcWarning, DailyBreakdown, EngineInput, EngineOutput } from "./types.js";

export type * from "./types.js";

/**
 * ShiftDay 1件の所定(分)を返す純関数を公開 API に出す(2026-08-24, v0.7 フェーズ4)。
 *
 * 理由: シフト制ユーザーの有給1日分の分数換算(apps/api/src/lib/leave-minutes.ts)は
 * 「その日のシフトの所定」を必要とするが、これは集計(calculate)の副産物ではなく
 * 単体で問い合わせたい値であり、apps/api 側で同じ計算(日跨ぎの +1440、休憩控除)を
 * 再実装すると engine の定義とズレる余地が生まれる。所定の定義は engine の1箇所に留める。
 */
export { shiftScheduledMinutes } from "./variable.js";

export function calculate(input: EngineInput): EngineOutput {
  const { workedSegments: rawWorkedSegments, breakSegments, warnings, stretches: rawStretches } = deriveSegments(
    input.punches,
    input.settingsTimeline,
  );

  // 休憩の自動控除(docs/design/breaks.md)。deriveSegments が確定させた punch 由来の
  // workedSegments/stretches に対する後段の変換であり、打刻列の解釈そのものには関与しない。
  const { workedSegments, autoDeductedSegments, stretches } = applyAutoBreakDeduction(
    rawWorkedSegments,
    rawStretches,
    input.settingsTimeline,
    input.autoBreakWaivedDates,
  );

  const rawDays = buildDailyBreakdown(
    workedSegments,
    breakSegments,
    input.settingsTimeline,
    input.lawTimeline,
    input.period,
    input.paidLeave,
    stretches,
    autoDeductedSegments,
  );

  // 手当対象時間(docs/design/allowances.md)。workedSegments(休憩・自動控除の控除後、
  // 法定休日の実労働も含む生のセグメント)を使うのは lateNightMinutes と同じ理由 — allowances.ts
  // のコメント参照。fixed.ts/flex.ts はどちらも各日を `{...day, ...他のフィールド}` で
  // 組み立て直すだけなので、ここで DailyBreakdown.allowances を確定させておけばそのまま素通りする。
  const allowanceTimeline = input.allowances ?? [];
  const allowanceMinutesByDate = computeAllowanceMinutesByDate(
    workedSegments,
    input.settingsTimeline,
    allowanceTimeline,
    input.period,
  );
  const days: DailyBreakdown[] = rawDays.map((day) => {
    const dateMap = allowanceMinutesByDate.get(day.date);
    if (!dateMap) return day;
    return {
      ...day,
      allowances: [...dateMap.entries()].map(([definitionId, minutes]) => ({ definitionId, minutes })),
    };
  });

  // 月合計。期間内のいずれかの日に有効だった定義は、合計が0分でも1件として含める
  // (types.ts の EngineOutput.allowanceTotals コメント参照 — 締め・CSV 側が「定義はあるが
  // 今月は対象時間なし」を表現できるようにするため、DailyBreakdown.allowances の sparse な
  // 扱いとはあえて非対称にしている)。
  const allowanceTotalsMap = new Map<string, number>();
  for (const day of days) {
    for (const definition of resolveAllowanceDefinitionsForDate(day.date, allowanceTimeline)) {
      if (!allowanceTotalsMap.has(definition.id)) allowanceTotalsMap.set(definition.id, 0);
    }
  }
  for (const dateMap of allowanceMinutesByDate.values()) {
    for (const [definitionId, minutes] of dateMap) {
      allowanceTotalsMap.set(definitionId, (allowanceTotalsMap.get(definitionId) ?? 0) + minutes);
    }
  }
  const allowanceTotals = [...allowanceTotalsMap.entries()].map(([definitionId, minutes]) => ({ definitionId, minutes }));

  // 休憩不足(labor law §34-1)は打刻列の解釈(deriveSegments)とは独立な判定であり、
  // 確定した stretches(workedMinutes/breakMinutes 込み)に対して行う。
  //
  // 自動控除は「休憩を取れたはず」という運用の前提に立つ機能であるため、34条充足の判定には
  // 「打刻休憩 + 自動控除」の合計を休憩として渡す(breaks.md「自動控除は労基法34条の充足として
  // 扱う」)。waiver された日は autoDeductedBreakMinutes が 0 のまま(=打刻休憩のみ)になり、
  // 休憩が実際に不足していれば自然にこの判定に引っかかる — 自動控除と不足検知が連動する要。
  const breakCheckStretches = stretches.map((stretch) =>
    stretch.breakMinutes === null
      ? stretch
      : { ...stretch, breakMinutes: stretch.breakMinutes + (stretch.autoDeductedBreakMinutes ?? 0) },
  );
  const breakWarnings = checkBreakSufficiency(
    breakCheckStretches,
    input.settingsTimeline,
    input.lawTimeline,
    input.period,
  );

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
      allowanceTotals,
    };
  }

  if (workSystemKind === "monthly_variable") {
    // workedSegments(打刻由来、休憩・自動控除の控除後)は buildDailyBreakdown と違って
    // period の月に絞り込まれていない生のセグメント列 — variable.ts の③期間段は変形期間
    // 全体(前後の月にまたがりうる)の実労働が要るため、この絞り込み前の値を渡す
    // (types.ts の EngineInput.shifts コメント「呼び出し側は期間全体分の punches/shifts を
    // 渡す」契約と対応する)。
    const { totals, days: variableDays, variablePeriod } = calculateVariableTotals(
      days,
      workedSegments,
      input.shifts ?? [],
      input.settingsTimeline,
      input.lawTimeline,
      input.period,
    );
    // シフト予実の乖離警告(docs/design/shift-work.md「予実の突合」)。totals には反映しない。
    const shiftVarianceWarnings = computeShiftVarianceWarnings(input.shifts ?? [], variableDays, input.settingsTimeline, input.asOfDate);
    return {
      days: variableDays,
      totals,
      flexBalance: null,
      workSystem: "monthly_variable",
      warnings: [...warnings, ...breakWarnings, ...shiftVarianceWarnings, ...mixedWarning],
      allowanceTotals,
      variablePeriod,
    };
  }

  const { totals, flexBalance } = calculateFlexBalance(
    days,
    input.settingsTimeline,
    input.lawTimeline,
    input.period,
    input.paidLeave,
  );
  // コアタイムの予実乖離(労基法32条の3、docs/design/work-systems.md「コアタイム」)。
  // totals・flexBalance には反映しない(コアタイムを外れても清算期間の総枠は変わらない)。
  // コアタイムは WorkSystem の flex 分岐にしかない概念なので、この分岐でだけ呼ぶ。
  const coreTimeWarnings = computeCoreTimeWarnings(days, input.settingsTimeline, input.asOfDate);
  return {
    days,
    totals,
    flexBalance,
    workSystem: "flex",
    warnings: [...warnings, ...breakWarnings, ...coreTimeWarnings, ...mixedWarning],
    allowanceTotals,
  };
}
