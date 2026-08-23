"use client";

import { type MonthlyAttendance, type TimeCategory } from "../../lib/api";
import { messages } from "../../lib/messages";
import { formatDurationHm } from "../../lib/time";
import { HelpTip } from "../HelpTip";

const TOTAL_CATEGORIES: TimeCategory[] = ["statutory", "overtime", "overtime60h", "lateNight", "statutoryHoliday"];

/** 当初値との差分テーブルの1行(区分別合計5種+flex収支3種)。 */
interface DiffRow {
  key: string;
  label: string;
  original: number;
  current: number;
}

/**
 * 締め後修正の差分行を組み立てる。区分別合計(統計内・残業等)は制度によらず出す一方、
 * フレックス収支・固定時間制内訳の差分行は現在・当初のどちらも値がある(=その制度)ときだけ出す
 * — 反対の制度では null になる(packages/engine の契約、work-systems.md)ため。
 */
function buildDiffRows(data: MonthlyAttendance): DiffRow[] {
  const original = data.figures.original;
  if (!data.closing.amended || !original) return [];
  const rows: DiffRow[] = TOTAL_CATEGORIES.map((cat) => ({
    key: cat,
    label: messages.totalsCategoryLabel[cat],
    original: original.totals[cat],
    current: data.figures.totals[cat],
  }));
  if (data.figures.flexBalance && original.flexBalance) {
    rows.push(
      { key: "flexFrame", label: messages.closing.diffFlexFrame, original: original.flexBalance.frameMinutes, current: data.figures.flexBalance.frameMinutes },
      { key: "flexActual", label: messages.closing.diffFlexActual, original: original.flexBalance.actualMinutes, current: data.figures.flexBalance.actualMinutes },
      { key: "flexDiff", label: messages.closing.diffFlexDiff, original: original.flexBalance.diffMinutes, current: data.figures.flexBalance.diffMinutes },
    );
  }
  // 固定時間制の内訳(所定内・法定内残業)も同じ理由で差分に含める(2026-08-23、fixedBreakdown 追加に伴う対応)。
  if (data.figures.fixedBreakdown && original.fixedBreakdown) {
    rows.push(
      {
        key: "fixedWithinScheduled",
        label: messages.monthly.fixedBreakdownWithinScheduledLabel,
        original: original.fixedBreakdown.withinScheduledMinutes,
        current: data.figures.fixedBreakdown.withinScheduledMinutes,
      },
      {
        key: "fixedExtra",
        label: messages.monthly.fixedBreakdownExtraLabel,
        original: original.fixedBreakdown.extraWithinStatutoryMinutes,
        current: data.figures.fixedBreakdown.extraWithinStatutoryMinutes,
      },
    );
  }
  // 手当の月合計も締め後修正の差分に含める(docs/design/allowances.md「締めとの関係」— 賃金に直結するため)。
  // 定義IDの和集合を取る(通常は current/original 双方に同じ定義が並ぶが、念のため片方にしか
  // 無いケースにも対応する)。
  const currentMap = new Map(data.figures.allowanceTotals.map((t) => [t.definitionId, t.minutes]));
  const originalMap = new Map(original.allowanceTotals.map((t) => [t.definitionId, t.minutes]));
  const ids = new Set([...currentMap.keys(), ...originalMap.keys()]);
  for (const id of ids) {
    const originalMinutes = originalMap.get(id) ?? 0;
    const currentMinutes = currentMap.get(id) ?? 0;
    if (originalMinutes === 0 && currentMinutes === 0) continue;
    rows.push({
      key: `allowance:${id}`,
      label: `${messages.monthly.allowanceDiffPrefix}${data.allowanceDefinitions[id] ?? id}`,
      original: originalMinutes,
      current: currentMinutes,
    });
  }
  return rows;
}

export interface ClosingDiffTableProps {
  data: MonthlyAttendance;
}

/**
 * 締め後修正の差分テーブル(当初値との比較)。MonthlyView から切り出したもの
 * (挙動不変、第3波分割)。
 */
export function ClosingDiffTable({ data }: ClosingDiffTableProps) {
  const diffRows = buildDiffRows(data);
  if (diffRows.length === 0) return null;

  return (
    <div className="closing-diff">
      <h2 className="closing-diff__title">
        {messages.closing.diffTitle}
        <HelpTip helpKey="closing.amend" />
      </h2>
      <div className="closing-diff__table-wrap">
        <table className="closing-diff__table">
          <thead>
            <tr>
              <th>{messages.closing.diffColumnCategory}</th>
              <th>{messages.closing.diffColumnOriginal}</th>
              <th>{messages.closing.diffColumnCurrent}</th>
              <th>{messages.closing.diffColumnDelta}</th>
            </tr>
          </thead>
          <tbody>
            {diffRows.map((row) => {
              const delta = row.current - row.original;
              return (
                <tr key={row.key}>
                  <td>{row.label}</td>
                  <td className="closing-diff__num tabular-nums">{formatDurationHm(row.original)}</td>
                  <td className="closing-diff__num tabular-nums">{formatDurationHm(row.current)}</td>
                  <td
                    className={`closing-diff__num tabular-nums ${delta < 0 ? "closing-diff__delta--negative" : "closing-diff__delta--positive"}`}
                  >
                    {delta >= 0 ? "+" : ""}
                    {formatDurationHm(delta)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
