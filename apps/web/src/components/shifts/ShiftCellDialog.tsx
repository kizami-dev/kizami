"use client";

import { useEffect, useRef, useState } from "react";
import type { ShiftDayDto, ShiftDayInput, ShiftDayType, ShiftPatternDto } from "../../lib/api";
import { messages } from "../../lib/messages";
import { hmToMinutes, minutesToHm } from "../../lib/time";

export interface ShiftCellDialogProps {
  date: string;
  initial: ShiftDayDto | null;
  /** アーカイブ済みを含む全パターン(選択中のパターンがアーカイブ済みでも表示は保つため)。 */
  patterns: ShiftPatternDto[];
  pending: boolean;
  error: string | null;
  onSubmit: (input: ShiftDayInput) => void;
  onCancel: () => void;
}

const DAY_TYPES: ShiftDayType[] = ["work", "legal_holiday", "non_working"];

/**
 * シフト表の1セル(1日)の編集ダイアログ(週グリッドから開く、決定事項2「パターン割当+個別編集」)。
 * パターンから選ぶか、日種別・時間を個別に指定するかを切り替えられる。
 */
export function ShiftCellDialog({ date, initial, patterns, pending, error, onSubmit, onCancel }: ShiftCellDialogProps) {
  const activePatterns = patterns.filter((p) => p.archivedAt === null || p.id === initial?.patternId);
  const [usePattern, setUsePattern] = useState(initial?.patternId !== null && initial?.patternId !== undefined ? true : activePatterns.length > 0);
  const [patternId, setPatternId] = useState(initial?.patternId ?? activePatterns[0]?.id ?? "");
  const [dayType, setDayType] = useState<ShiftDayType>(initial?.dayType ?? "work");
  const [startHm, setStartHm] = useState(initial ? minutesToHm(initial.startMinutes) : "09:00");
  const [endHm, setEndHm] = useState(initial ? minutesToHm(initial.endMinutes) : "18:00");
  const [breakMinutesText, setBreakMinutesText] = useState(initial ? String(initial.breakMinutes) : "60");
  const [localError, setLocalError] = useState<string | null>(null);
  const firstFieldRef = useRef<HTMLSelectElement>(null);

  useEffect(() => {
    firstFieldRef.current?.focus();
  }, []);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onCancel]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLocalError(null);
    if (usePattern) {
      if (!patternId) {
        setLocalError(messages.shifts.errors.invalid_pattern_id);
        return;
      }
      onSubmit({ date, patternId });
      return;
    }
    if (dayType !== "work") {
      onSubmit({ date, dayType });
      return;
    }
    const startMinutes = hmToMinutes(startHm);
    const endMinutes = hmToMinutes(endHm);
    if (startMinutes === null || endMinutes === null) {
      setLocalError(messages.shifts.errors.invalid_minutes);
      return;
    }
    const breakMinutes = Number(breakMinutesText);
    if (!Number.isInteger(breakMinutes) || breakMinutes < 0) {
      setLocalError(messages.shifts.errors.invalid_break_minutes);
      return;
    }
    onSubmit({ date, dayType, startMinutes, endMinutes, breakMinutes });
  }

  return (
    <div className="k-modal__backdrop" onClick={onCancel}>
      <div
        className="k-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="shift-cell-dialog-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="k-modal__header">
          <h2 id="shift-cell-dialog-title" className="k-modal__title">
            {messages.shifts.cellDialogTitle(date)}
          </h2>
          <button type="button" className="k-modal__close" onClick={onCancel} aria-label={messages.corrections.close}>
            ×
          </button>
        </div>
        <form className="k-modal__body" onSubmit={handleSubmit}>
          {activePatterns.length > 0 ? (
            <div className="correction-field">
              <label htmlFor="shift-cell-pattern">{messages.shifts.cellDialogPatternLabel}</label>
              <select
                id="shift-cell-pattern"
                ref={firstFieldRef}
                value={usePattern ? patternId : ""}
                onChange={(e) => {
                  if (e.target.value === "") {
                    setUsePattern(false);
                  } else {
                    setUsePattern(true);
                    setPatternId(e.target.value);
                  }
                }}
              >
                <option value="">{messages.shifts.cellDialogPatternNone}</option>
                {activePatterns.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          {!usePattern ? (
            <>
              <div className="correction-field">
                <label htmlFor="shift-cell-day-type">{messages.shifts.cellDialogDayTypeLabel}</label>
                <select id="shift-cell-day-type" value={dayType} onChange={(e) => setDayType(e.target.value as ShiftDayType)}>
                  {DAY_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {messages.shiftDayTypeLabel[t]}
                    </option>
                  ))}
                </select>
              </div>
              {dayType === "work" ? (
                <>
                  <div className="correction-field">
                    <label htmlFor="shift-cell-start">{messages.shifts.cellDialogStartLabel}</label>
                    <input id="shift-cell-start" type="time" value={startHm} onChange={(e) => setStartHm(e.target.value)} required />
                  </div>
                  <div className="correction-field">
                    <label htmlFor="shift-cell-end">{messages.shifts.cellDialogEndLabel}</label>
                    <input id="shift-cell-end" type="time" value={endHm} onChange={(e) => setEndHm(e.target.value)} required />
                  </div>
                  <div className="correction-field">
                    <label htmlFor="shift-cell-break">{messages.shifts.cellDialogBreakLabel}</label>
                    <input
                      id="shift-cell-break"
                      type="number"
                      min={0}
                      value={breakMinutesText}
                      onChange={(e) => setBreakMinutesText(e.target.value)}
                      required
                    />
                  </div>
                </>
              ) : null}
            </>
          ) : null}

          {localError || error ? (
            <p className="correction-error" role="alert">
              {localError ?? error}
            </p>
          ) : null}

          <div className="k-modal__footer">
            <button type="button" className="k-modal__cancel" onClick={onCancel} disabled={pending}>
              {messages.shifts.cellDialogCancel}
            </button>
            <button type="submit" className="k-modal__confirm k-modal__confirm--neutral" disabled={pending}>
              {pending ? messages.shifts.cellDialogSaving : messages.shifts.cellDialogSave}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
