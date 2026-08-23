"use client";

import { type MonthlyAttendance, type TimeCategory } from "../../lib/api";
import { messages } from "../../lib/messages";
import { formatDurationHm } from "../../lib/time";

const TOTAL_CATEGORIES: TimeCategory[] = ["statutory", "overtime", "overtime60h", "lateNight", "statutoryHoliday"];

export interface MonthlyTotalsProps {
  data: MonthlyAttendance;
}

/**
 * 区分別合計チップ + 固定時間制の内訳(所定内・法定内残業) + 手当対象時間の月合計。
 * MonthlyView から切り出したもの(挙動不変、第3波分割)。
 *
 * fixedBreakdown(2026-08-23 追加、GET /attendance/monthly 契約変更)は固定時間制のみ非nullで、
 * 区分別合計チップの下・手当合計チップの上に、手当合計と同じチップ型で出す(依頼どおり)。
 */
export function MonthlyTotals({ data }: MonthlyTotalsProps) {
  const fixedBreakdown = data.figures.fixedBreakdown;
  return (
    <>
      <div>
        <p className="flex-balance__label">{messages.monthly.totalsLabel}</p>
        <div className="totals-row">
          {TOTAL_CATEGORIES.map((cat) => (
            <span key={cat} className={`totals-chip totals-chip--${cat}`}>
              <span className="totals-chip__label">{messages.totalsCategoryLabel[cat]}</span>
              <span className="totals-chip__value tabular-nums">{formatDurationHm(data.figures.totals[cat])}</span>
            </span>
          ))}
        </div>
      </div>

      {fixedBreakdown ? (
        <div>
          <p className="flex-balance__label">{messages.monthly.fixedBreakdownLabel}</p>
          <div className="totals-row">
            <span className="totals-chip">
              <span className="totals-chip__label">{messages.monthly.fixedBreakdownWithinScheduledLabel}</span>
              <span className="totals-chip__value tabular-nums">{formatDurationHm(fixedBreakdown.withinScheduledMinutes)}</span>
            </span>
            <span className="totals-chip">
              <span className="totals-chip__label">{messages.monthly.fixedBreakdownExtraLabel}</span>
              <span className="totals-chip__value tabular-nums">{formatDurationHm(fixedBreakdown.extraWithinStatutoryMinutes)}</span>
            </span>
          </div>
        </div>
      ) : null}

      {/*
        手当対象時間の月合計(docs/design/allowances.md「UI」節)。区分別合計チップの下に、
        手当ごとの行として出す。0分の定義は出さない(EngineOutput.allowanceTotals は
        期間内に有効だった定義を0分でも1件として含めるため、ここでフィルタする)。
      */}
      {data.figures.allowanceTotals.some((t) => t.minutes > 0) ? (
        <div>
          <p className="flex-balance__label">{messages.monthly.allowanceTotalsLabel}</p>
          <div className="totals-row">
            {data.figures.allowanceTotals
              .filter((t) => t.minutes > 0)
              .map((t) => (
                <span key={t.definitionId} className="totals-chip">
                  <span className="totals-chip__label">{data.allowanceDefinitions[t.definitionId] ?? t.definitionId}</span>
                  <span className="totals-chip__value tabular-nums">{formatDurationHm(t.minutes)}</span>
                </span>
              ))}
          </div>
        </div>
      ) : null}
    </>
  );
}
