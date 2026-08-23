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
 * フレックス収支の差分行は現在・当初のどちらも flexBalance がある(=フレックス)ときだけ出す
 * — 固定時間制では flexBalance が null になる(packages/engine の契約、work-systems.md)ため。
 */
function buildDiffRows(data: MonthlyAttendance): DiffRow[] {
  if (!data.amended || !data.originalTotals) return [];
  const rows: DiffRow[] = TOTAL_CATEGORIES.map((cat) => ({
    key: cat,
    label: messages.totalsCategoryLabel[cat],
    original: data.originalTotals![cat],
    current: data.totals[cat],
  }));
  if (data.flexBalance && data.originalFlexBalance) {
    rows.push(
      { key: "flexFrame", label: messages.closing.diffFlexFrame, original: data.originalFlexBalance.frameMinutes, current: data.flexBalance.frameMinutes },
      { key: "flexActual", label: messages.closing.diffFlexActual, original: data.originalFlexBalance.actualMinutes, current: data.flexBalance.actualMinutes },
      { key: "flexDiff", label: messages.closing.diffFlexDiff, original: data.originalFlexBalance.diffMinutes, current: data.flexBalance.diffMinutes },
    );
  }
  // 手当の月合計も締め後修正の差分に含める(docs/design/allowances.md「締めとの関係」— 賃金に直結するため)。
  // 定義IDの和集合を取る(通常は current/original 双方に同じ定義が並ぶが、念のため片方にしか
  // 無いケースにも対応する)。
  if (data.originalAllowanceTotals) {
    const currentMap = new Map(data.allowanceTotals.map((t) => [t.definitionId, t.minutes]));
    const originalMap = new Map(data.originalAllowanceTotals.map((t) => [t.definitionId, t.minutes]));
    const ids = new Set([...currentMap.keys(), ...originalMap.keys()]);
    for (const id of ids) {
      const original = originalMap.get(id) ?? 0;
      const current = currentMap.get(id) ?? 0;
      if (original === 0 && current === 0) continue;
      rows.push({
        key: `allowance:${id}`,
        label: `${messages.monthly.allowanceDiffPrefix}${data.allowanceDefinitions[id] ?? id}`,
        original,
        current,
      });
    }
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
