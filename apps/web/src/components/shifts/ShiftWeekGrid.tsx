"use client";

import type { ShiftDayDto, ShiftPatternDto } from "../../lib/api";
import { messages } from "../../lib/messages";
import { minutesToHm } from "../../lib/time";
import { buildWeekGrid, shiftDaysByDate } from "../../lib/shifts";

export interface ShiftWeekGridProps {
  periodStart: string;
  periodEnd: string;
  days: readonly ShiftDayDto[];
  patterns: readonly ShiftPatternDto[];
  /** 省略時(本人のシフト閲覧、ShiftsMeView)はセルを非インタラクティブな読み取り専用表示にする。 */
  onCellClick?: (date: string) => void;
}

/**
 * シフト表の週グリッド(行=週、列=曜日〈日〜土〉、docs/design/shift-work.md 決定事項2)。
 * K主体の静かなテーブル(docs/design/ui-direction.md)— CMYKは打刻アクションの意味に固定されて
 * いるため、日種別の塗り分けには使わず、テキストラベル+枠線の濃淡だけで区別する。
 */
export function ShiftWeekGrid({ periodStart, periodEnd, days, patterns, onCellClick }: ShiftWeekGridProps) {
  const rows = buildWeekGrid(periodStart, periodEnd);
  const dayMap = shiftDaysByDate(days);
  const patternNameById = new Map(patterns.map((p) => [p.id, p.name]));

  return (
    <div className="shifts-grid">
      <div className="shifts-grid__weekday-row">
        {messages.time.weekdayShort.map((label, w) => (
          <span key={w} className="shifts-grid__weekday-label">
            {label}
          </span>
        ))}
      </div>
      {rows.map((row, rowIndex) => (
        <div className="shifts-grid__week-row" key={rowIndex}>
          {row.map((cell) => {
            if (!cell.inPeriod) {
              return <div key={cell.date} className="shifts-grid__cell shifts-grid__cell--out-of-period" aria-hidden="true" />;
            }
            const shift = dayMap.get(cell.date);
            const dayOfMonth = Number(cell.date.slice(8, 10));
            const content = (
              <>
                <span className="shifts-grid__cell-date tabular-nums">{dayOfMonth}</span>
                {shift ? (
                  <>
                    {shift.dayType === "work" ? (
                      <span className="shifts-grid__cell-time tabular-nums">
                        {minutesToHm(shift.startMinutes)} → {minutesToHm(shift.endMinutes)}
                      </span>
                    ) : (
                      <span className="shifts-grid__cell-label">{messages.shiftDayTypeLabel[shift.dayType]}</span>
                    )}
                    {shift.patternId ? (
                      <span className="shifts-grid__cell-pattern">{patternNameById.get(shift.patternId) ?? ""}</span>
                    ) : null}
                  </>
                ) : (
                  <span className="shifts-grid__cell-empty">{messages.shifts.cellEmpty}</span>
                )}
              </>
            );
            return onCellClick ? (
              <button
                key={cell.date}
                type="button"
                className={`shifts-grid__cell shifts-grid__cell--${shift?.dayType ?? "unset"}`}
                onClick={() => onCellClick(cell.date)}
              >
                {content}
              </button>
            ) : (
              <div key={cell.date} className={`shifts-grid__cell shifts-grid__cell--${shift?.dayType ?? "unset"} shifts-grid__cell--readonly`}>
                {content}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
