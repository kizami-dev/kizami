/**
 * KIZAMI 集計エンジン
 *
 * 制約(要件 §8/§9):
 * - 純関数のみ。I/O・Date.now()・タイムゾーン暗黙依存を持たない
 * - Node と workerd の両方で同一に動作する
 * - 入力は打刻列+テナント設定、出力は区分別時間数(分単位)
 */

import { buildDailyBreakdown } from "./daily.js";
import { deriveSegments } from "./derive.js";
import { calculateFlexBalance } from "./flex.js";
import type { EngineInput, EngineOutput } from "./types.js";

export type * from "./types.js";

export function calculate(input: EngineInput): EngineOutput {
  const { workedSegments, breakSegments, warnings } = deriveSegments(input.punches, input.settingsTimeline);

  const days = buildDailyBreakdown(
    workedSegments,
    breakSegments,
    input.settingsTimeline,
    input.period,
    input.paidLeave,
  );

  const { totals, flexBalance } = calculateFlexBalance(
    days,
    input.settingsTimeline,
    input.period,
    input.paidLeave,
  );

  return { days, totals, flexBalance, warnings };
}
