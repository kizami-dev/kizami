/**
 * EngineOutput(packages/engine の calculate() の戻り値)と closing_snapshots の行
 * (packages/db/src/schema/closings.ts の ClosingSnapshotCategory)の相互変換。
 *
 * closing_snapshots は「区分別時間数5種 + flex収支3種」を同じ `category` + `minutes` 形式で
 * 保持する設計(schema/closings.ts の判断点コメント参照)。engine 側の型(CategorizedMinutes /
 * FlexBalance)とはキー名が違う("statutoryHoliday" vs flex の "frameMinutes" 等)ため、
 * その変換をここに閉じる。
 */

import type { CategorizedMinutes, FlexBalance, TimeCategory } from "@kizami/engine";
import type { ClosingSnapshot, ClosingSnapshotCategory, NewClosingSnapshotInput } from "@kizami/db";

const TIME_CATEGORIES: readonly TimeCategory[] = ["statutory", "overtime", "overtime60h", "lateNight", "statutoryHoliday"];

/** 締め確定時: 1ユーザー分の EngineOutput(totals + flexBalance)を保存用の行に変換する。 */
export function snapshotInputsFromEngineOutput(params: {
  tenantId: string;
  closingEventId: string;
  userId: string;
  totals: CategorizedMinutes;
  flexBalance: FlexBalance;
}): NewClosingSnapshotInput[] {
  const { tenantId, closingEventId, userId, totals, flexBalance } = params;
  const base = { tenantId, closingEventId, userId };

  const timeRows: NewClosingSnapshotInput[] = TIME_CATEGORIES.map((category) => ({
    ...base,
    category,
    minutes: totals[category],
  }));

  const flexRows: NewClosingSnapshotInput[] = [
    { ...base, category: "flexFrame", minutes: flexBalance.frameMinutes },
    { ...base, category: "flexActual", minutes: flexBalance.actualMinutes },
    { ...base, category: "flexDiff", minutes: flexBalance.diffMinutes },
  ];

  return [...timeRows, ...flexRows];
}

export interface SnapshotTotals {
  totals: CategorizedMinutes;
  flexBalance: FlexBalance;
}

/** 「未初期化(0埋め)」の totals/flexBalance。スナップショットに一部カテゴリが欠けていた場合の既定値。 */
function emptyTotals(): SnapshotTotals {
  return {
    totals: { statutory: 0, overtime: 0, overtime60h: 0, lateNight: 0, statutoryHoliday: 0 },
    flexBalance: { frameMinutes: 0, actualMinutes: 0, diffMinutes: 0 },
  };
}

/**
 * 締め済み月の月次表示・CSVエクスポートが読む側: 1ユーザー分の closing_snapshots 行列から
 * totals/flexBalance を組み立て直す。該当ユーザーの行が1つも無ければ(締め時点で対象外だった
 * 等)0埋めの既定値を返す。
 */
export function engineOutputFromSnapshots(snapshots: ClosingSnapshot[]): SnapshotTotals {
  const result = emptyTotals();
  for (const row of snapshots) {
    const category = row.category as ClosingSnapshotCategory;
    switch (category) {
      case "statutory":
      case "overtime":
      case "overtime60h":
      case "lateNight":
      case "statutoryHoliday":
        (result.totals as Record<TimeCategory, number>)[category] = row.minutes;
        break;
      case "flexFrame":
        result.flexBalance.frameMinutes = row.minutes;
        break;
      case "flexActual":
        result.flexBalance.actualMinutes = row.minutes;
        break;
      case "flexDiff":
        result.flexBalance.diffMinutes = row.minutes;
        break;
    }
  }
  return result;
}
