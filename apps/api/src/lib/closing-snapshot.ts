/**
 * EngineOutput(packages/engine の calculate() の戻り値)と closing_snapshots の行
 * (packages/db/src/schema/closings.ts の ClosingSnapshotCategory)の相互変換。
 *
 * closing_snapshots は「区分別時間数5種 + flex収支3種 + 固定時間制内訳2種」を同じ
 * `category` + `minutes` 形式で保持する設計(schema/closings.ts の判断点コメント参照)。engine 側の
 * 型(CategorizedMinutes / FlexBalance / DailyBreakdown)とはキー名が違う("statutoryHoliday" vs
 * flex の "frameMinutes" 等)ため、その変換をここに閉じる。
 */

import type { CategorizedMinutes, DailyBreakdown, EngineOutput, FlexBalance, TimeCategory } from "@kizami/engine";
import { ALLOWANCE_CLOSING_SNAPSHOT_CATEGORY_PREFIX, type ClosingSnapshot, type ClosingSnapshotCategory, type NewClosingSnapshotInput } from "@kizami/db";

const TIME_CATEGORIES: readonly TimeCategory[] = ["statutory", "overtime", "overtime60h", "lateNight", "statutoryHoliday"];

/**
 * 固定時間制の内訳(所定内・法定内残業)の月合計。フレックスでは存在しない(null)。
 *
 * EngineOutput.totals.statutory は「所定内 + 法定内残業」の合計で、この2つを分けた粒度を
 * 持たない(packages/engine の CategorizedMinutes 参照)。給与計算では所定内(基本給の範囲)と
 * 法定内残業(時間外手当だが割増なし)を分けて扱うため、closing_snapshots にはこの内訳を
 * 別に持つ必要がある(docs/design/work-systems.md 参照)。
 */
export interface FixedBreakdownTotals {
  withinScheduledMinutes: number;
  extraWithinStatutoryMinutes: number;
}

/** EngineOutput.days から固定時間制の内訳を合算する。フレックスの月では呼ばない(常に0なので無意味)。 */
export function sumFixedBreakdown(days: DailyBreakdown[]): FixedBreakdownTotals {
  return days.reduce<FixedBreakdownTotals>(
    (acc, day) => ({
      withinScheduledMinutes: acc.withinScheduledMinutes + day.withinScheduledMinutes,
      extraWithinStatutoryMinutes: acc.extraWithinStatutoryMinutes + day.extraWithinStatutoryMinutes,
    }),
    { withinScheduledMinutes: 0, extraWithinStatutoryMinutes: 0 },
  );
}

/**
 * 締め確定時: 1ユーザー分の EngineOutput を保存用の行に変換する。
 *
 * `output.flexBalance` が null(固定時間制)なら flex 系3行(flexFrame/flexActual/flexDiff)を、
 * `output.workSystem` が "flex" なら固定系2行(fixedWithinScheduled/fixedExtraWithinStatutory)を
 * それぞれ一切書かない — 0埋めで保存すると、読み戻し側(engineOutputFromSnapshots)が「制度が
 * 違うので存在しない」のか「たまたま0だった」のか区別できなくなる(行の有無で制度を判定する
 * 設計、下記 engineOutputFromSnapshots 参照)。flex/fixed は排他(EngineOutput.workSystem で
 * 決まる)なので、必ずどちらか一方の追加行だけが書かれる。
 *
 * 呼び出し側は totals/flexBalance を個別に渡すのではなく EngineOutput をまるごと渡す
 * (apps/api/src/routes/closings.ts・corrections.ts・leave.ts の3箇所で「workSystem を見て
 * fixedBreakdown を組み立てるか null にするか」という同じ分岐を書かずに済ませるため、
 * その分岐をここに集約した)。
 */
export function snapshotInputsFromEngineOutput(params: {
  tenantId: string;
  closingEventId: string;
  userId: string;
  output: EngineOutput;
}): NewClosingSnapshotInput[] {
  const { tenantId, closingEventId, userId, output } = params;
  const base = { tenantId, closingEventId, userId };

  const timeRows: NewClosingSnapshotInput[] = TIME_CATEGORIES.map((category) => ({
    ...base,
    category,
    minutes: output.totals[category],
  }));

  const flexRows: NewClosingSnapshotInput[] =
    output.flexBalance === null
      ? []
      : [
          { ...base, category: "flexFrame", minutes: output.flexBalance.frameMinutes },
          { ...base, category: "flexActual", minutes: output.flexBalance.actualMinutes },
          { ...base, category: "flexDiff", minutes: output.flexBalance.diffMinutes },
        ];

  const fixedBreakdown = output.workSystem === "fixed" ? sumFixedBreakdown(output.days) : null;
  const fixedRows: NewClosingSnapshotInput[] =
    fixedBreakdown === null
      ? []
      : [
          { ...base, category: "fixedWithinScheduled", minutes: fixedBreakdown.withinScheduledMinutes },
          { ...base, category: "fixedExtraWithinStatutory", minutes: fixedBreakdown.extraWithinStatutoryMinutes },
        ];

  // 手当(docs/design/allowances.md「締めとの関係」)。定義IDごとに `allowance:<definitionId>`
  // という動的な category で保存する(schema/closings.ts の ALLOWANCE_CLOSING_SNAPSHOT_CATEGORY_PREFIX
  // コメント参照)。output.allowanceTotals は「期間内のいずれかの日に有効だった定義は0分でも
  // 1件含む」契約(engine/src/index.ts 参照)なので、fixedBreakdown 等と違い null 分岐は無く
  // 常にその件数ぶんの行を書く(手当を1つも定義していないテナントでは空配列 = 行0件)。
  const allowanceRows: NewClosingSnapshotInput[] = output.allowanceTotals.map((t) => ({
    ...base,
    category: `${ALLOWANCE_CLOSING_SNAPSHOT_CATEGORY_PREFIX}${t.definitionId}`,
    minutes: t.minutes,
  }));

  return [...timeRows, ...flexRows, ...fixedRows, ...allowanceRows];
}

export interface SnapshotTotals {
  totals: CategorizedMinutes;
  /** flex 系の行が1つも無ければ null(固定時間制だった月、または対象ユーザーの行が皆無)。 */
  flexBalance: FlexBalance | null;
  /** 固定系の行が1つも無ければ null(フレックスだった月、または対象ユーザーの行が皆無)。 */
  fixedBreakdown: FixedBreakdownTotals | null;
  /**
   * 手当定義ごとの月合計(分)。行が無ければ空配列(手当を1つも定義していなかった、または
   * 対象ユーザーの行が締め時点で皆無だった月)。fixedBreakdown と違い null にしない — 「定義が
   * 無かった」と「定義はあるが0分だった」は snapshotInputsFromEngineOutput の契約上どちらも
   * ここでは区別できない情報ではなく、単に「行があれば0分でも含める」で表現できるため。
   */
  allowanceTotals: Array<{ definitionId: string; minutes: number }>;
}

/** 「未初期化(0埋め)」の区分別時間数。スナップショットに一部カテゴリが欠けていた場合の既定値。 */
function emptyCategorizedMinutes(): CategorizedMinutes {
  return { statutory: 0, overtime: 0, overtime60h: 0, lateNight: 0, statutoryHoliday: 0 };
}

/**
 * 締め済み月の月次表示・CSVエクスポートが読む側: 1ユーザー分の closing_snapshots 行列から
 * totals/flexBalance/fixedBreakdown を組み立て直す。
 *
 * totals(区分別時間数5種)は該当ユーザーの行が1つも無ければ(締め時点で対象外だった等)
 * 0埋めの既定値を返す — 5種は制度によらず必ず書かれる行なので、欠けているのは「無かった」
 * ことの表現として0で問題ない。
 *
 * flexBalance と fixedBreakdown は逆に、対応する行が1つも無ければ null を返す(0埋めにしない)。
 * flex の月は fixed 系の行を、fixed の月は flex 系の行を書かない(snapshotInputsFromEngineOutput
 * 参照)ため、「行の有無」がそのまま制度の見分け方になる。
 *
 * **flexBalance と fixedBreakdown が両方 null になるケース**: 締め時点でこのユーザーの行が
 * 1行も書かれなかった場合(closings.ts の close 処理はテナント設定・制度割当が揃っていない
 * ユーザーをスキップする、等)。これは「フレックス」でも「固定時間制」でもなく「この
 * ユーザーの集計が締め時点に存在しなかった」ことを意味する。呼び出し側はこの状態を
 * 「未確定・表示不能」として扱うべきで、どちらか一方の制度だとみなしたり0扱いにしては
 * ならない(totals はこのケースでも0埋めで返るが、それは「集計が無かった」ことの表現であって
 * 「実績0だった」ことの表現ではない点に注意)。
 */
export function engineOutputFromSnapshots(snapshots: ClosingSnapshot[]): SnapshotTotals {
  const totals = emptyCategorizedMinutes();
  let flexFrameMinutes = 0;
  let flexActualMinutes = 0;
  let flexDiffMinutes = 0;
  let hasFlexRow = false;
  let fixedWithinScheduledMinutes = 0;
  let fixedExtraWithinStatutoryMinutes = 0;
  let hasFixedRow = false;
  const allowanceTotals: Array<{ definitionId: string; minutes: number }> = [];

  for (const row of snapshots) {
    // 手当は category が `allowance:<definitionId>` という動的な文字列であり、
    // CLOSING_SNAPSHOT_CATEGORIES の固定列挙(下の switch)には含まれない
    // (schema/closings.ts の ALLOWANCE_CLOSING_SNAPSHOT_CATEGORY_PREFIX コメント参照)。
    // switch に通す前にここで分岐する。
    if (row.category.startsWith(ALLOWANCE_CLOSING_SNAPSHOT_CATEGORY_PREFIX)) {
      allowanceTotals.push({
        definitionId: row.category.slice(ALLOWANCE_CLOSING_SNAPSHOT_CATEGORY_PREFIX.length),
        minutes: row.minutes,
      });
      continue;
    }

    const category = row.category as ClosingSnapshotCategory;
    switch (category) {
      case "statutory":
      case "overtime":
      case "overtime60h":
      case "lateNight":
      case "statutoryHoliday":
        (totals as Record<TimeCategory, number>)[category] = row.minutes;
        break;
      case "flexFrame":
        hasFlexRow = true;
        flexFrameMinutes = row.minutes;
        break;
      case "flexActual":
        hasFlexRow = true;
        flexActualMinutes = row.minutes;
        break;
      case "flexDiff":
        hasFlexRow = true;
        flexDiffMinutes = row.minutes;
        break;
      case "fixedWithinScheduled":
        hasFixedRow = true;
        fixedWithinScheduledMinutes = row.minutes;
        break;
      case "fixedExtraWithinStatutory":
        hasFixedRow = true;
        fixedExtraWithinStatutoryMinutes = row.minutes;
        break;
    }
  }

  return {
    totals,
    flexBalance: hasFlexRow
      ? { frameMinutes: flexFrameMinutes, actualMinutes: flexActualMinutes, diffMinutes: flexDiffMinutes }
      : null,
    fixedBreakdown: hasFixedRow
      ? { withinScheduledMinutes: fixedWithinScheduledMinutes, extraWithinStatutoryMinutes: fixedExtraWithinStatutoryMinutes }
      : null,
    allowanceTotals,
  };
}
