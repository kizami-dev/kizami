"use client";

import type { ShiftDayDto } from "../../lib/api";
import { messages } from "../../lib/messages";
import { buildWeekGrid, shiftDaysByDate, weekdayOf } from "../../lib/shifts";
import { dateStrFromEpochMinutesJst, formatMonthDayShort, minutesToHm, nowMinutes } from "../../lib/time";

export interface ShiftWeekListProps {
  periodStart: string;
  periodEnd: string;
  days: readonly ShiftDayDto[];
}

/**
 * 本人のシフトの縦リスト(狭い画面用、週ごとにまとめる)。7 列のグリッドは 640px 以下で
 * 横スクロールになり木〜土が見えないため、そこではこちらを出す(CSS で出し分け、shifts.css)。
 * 今日の行は左の罫線(C)と「今日」の文字で示す。
 */
export function ShiftWeekList({ periodStart, periodEnd, days }: ShiftWeekListProps) {
  const rows = buildWeekGrid(periodStart, periodEnd);
  const dayMap = shiftDaysByDate(days);
  const today = dateStrFromEpochMinutesJst(nowMinutes());

  return (
    <div className="shifts-list">
      {rows.map((row, rowIndex) => {
        const cells = row.filter((c) => c.inPeriod);
        if (cells.length === 0) return null;
        const first = cells[0]!;
        const last = cells[cells.length - 1]!;
        return (
          <section key={rowIndex} className="shifts-list__week" aria-label={`${formatMonthDayShort(first.date)} - ${formatMonthDayShort(last.date)}`}>
            <h3 className="shifts-list__week-title tabular-nums">
              {formatMonthDayShort(first.date)} - {formatMonthDayShort(last.date)}
            </h3>
            <ul className="shifts-list__days">
              {cells.map((cell) => {
                const shift = dayMap.get(cell.date);
                const isToday = cell.date === today;
                return (
                  <li key={cell.date} className={`shifts-list__day${isToday ? " shifts-list__day--today" : ""}${shift?.dayType === "work" ? "" : " shifts-list__day--off"}`}>
                    <span className="shifts-list__date tabular-nums">
                      {Number(cell.date.slice(8, 10))}
                      <span className="shifts-list__weekday">({messages.time.weekdayShort[weekdayOf(cell.date)]})</span>
                    </span>
                    <span className="shifts-list__value tabular-nums">
                      {shift
                        ? shift.dayType === "work"
                          ? `${minutesToHm(shift.startMinutes)} → ${minutesToHm(shift.endMinutes)}`
                          : messages.shiftDayTypeLabel[shift.dayType]
                        : messages.shifts.cellEmpty}
                    </span>
                    {isToday ? <span className="shifts-list__today">{messages.shiftsMe.todayLabel}</span> : null}
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
