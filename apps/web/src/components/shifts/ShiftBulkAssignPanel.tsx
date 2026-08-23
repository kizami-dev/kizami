"use client";

import { useState } from "react";
import type { ShiftDayInput, ShiftPatternDto } from "../../lib/api";
import { dateRangeInclusive, weekdayOf } from "../../lib/shifts";
import { messages } from "../../lib/messages";

export interface ShiftBulkAssignPanelProps {
  periodStart: string;
  periodEnd: string;
  /** アーカイブされていないパターンのみ(まとめて割当は新規適用のため、アーカイブ済みは選べない)。 */
  patterns: ShiftPatternDto[];
  pending: boolean;
  error: string | null;
  onApply: (days: ShiftDayInput[]) => void;
}

const WEEKDAYS: (0 | 1 | 2 | 3 | 4 | 5 | 6)[] = [0, 1, 2, 3, 4, 5, 6];

/**
 * 「まとめて割当」(docs/design/shift-work.md 決定事項2「入力コスト削減の要」)。
 * 曜日ごとにパターンを指定し、期間全体に一括で適用する。1回の PUT にまとめて送る
 * (曜日ごとに個別リクエストを送らない — 部分的な失敗で一部の曜日だけ反映される事態を避ける)。
 */
export function ShiftBulkAssignPanel({ periodStart, periodEnd, patterns, pending, error, onApply }: ShiftBulkAssignPanelProps) {
  const [selection, setSelection] = useState<Record<number, string>>({});

  const periodDates = dateRangeInclusive(periodStart, periodEnd);
  const hasSelection = Object.values(selection).some((v) => v !== "" && v !== undefined);

  function handleApply() {
    const days: ShiftDayInput[] = [];
    for (const date of periodDates) {
      const patternId = selection[weekdayOf(date)];
      if (patternId) days.push({ date, patternId });
    }
    if (days.length > 0) onApply(days);
  }

  return (
    <section className="shifts-bulk-assign">
      <h2 className="shifts-panel__title">{messages.shifts.bulkAssignTitle}</h2>
      <p className="shifts-panel__hint">{messages.shifts.bulkAssignHint}</p>

      <div className="shifts-bulk-assign__rows">
        {WEEKDAYS.map((w) => (
          <div className="shifts-bulk-assign__row" key={w}>
            <span className="shifts-bulk-assign__weekday">{messages.time.weekdayShort[w]}</span>
            <select
              aria-label={messages.time.weekdayShort[w]}
              value={selection[w] ?? ""}
              onChange={(e) => setSelection((prev) => ({ ...prev, [w]: e.target.value }))}
            >
              <option value="">{messages.shifts.bulkAssignNoneOption}</option>
              {patterns.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>

      {error ? (
        <p className="correction-error" role="alert">
          {error}
        </p>
      ) : null}

      <button
        type="button"
        className="k-modal__confirm k-modal__confirm--neutral"
        onClick={handleApply}
        disabled={pending || !hasSelection}
      >
        {pending ? messages.shifts.bulkAssignApplying : messages.shifts.bulkAssignApply}
      </button>
    </section>
  );
}
