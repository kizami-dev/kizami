"use client";

import { useEffect, useRef, useState } from "react";
import type { ShiftDayType } from "../lib/api";
import { messages } from "../lib/messages";
import { hmToMinutes, minutesToHm } from "../lib/time";

export interface ShiftPatternFormValue {
  name: string;
  dayType: ShiftDayType;
  startMinutes: number;
  endMinutes: number;
  breakMinutes: number;
}

export interface ShiftPatternFormDialogProps {
  pending: boolean;
  error: string | null;
  onSubmit: (value: ShiftPatternFormValue) => void;
  onCancel: () => void;
}

const DAY_TYPES: ShiftDayType[] = ["work", "legal_holiday", "non_working"];

/**
 * シフトパターンの追加フォーム(モーダル)。/settings/shift-patterns から開く。
 * パターンに編集APIは無い(作成専用、apps/api/src/routes/settings/shift-patterns.ts —
 * 変更したい場合はアーカイブして作り直す。既に割り当て済みのシフトは shift_days 側に値が
 * 複製済みのため影響しない)。dayType が work 以外のときは start/end/breakMinutes の入力欄を隠す
 * (SettingsAttendanceView の休憩ルールと同じ「該当時だけ出す」作法)。
 */
export function ShiftPatternFormDialog({ pending, error, onSubmit, onCancel }: ShiftPatternFormDialogProps) {
  const [name, setName] = useState("");
  const [dayType, setDayType] = useState<ShiftDayType>("work");
  const [startHm, setStartHm] = useState("09:00");
  const [endHm, setEndHm] = useState("18:00");
  const [breakMinutesText, setBreakMinutesText] = useState("60");
  const [localError, setLocalError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    nameRef.current?.focus();
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
    if (name.trim().length === 0) {
      setLocalError(messages.shiftPatterns.errors.invalid_name);
      return;
    }
    if (dayType !== "work") {
      onSubmit({ name, dayType, startMinutes: 0, endMinutes: 0, breakMinutes: 0 });
      return;
    }
    const startMinutes = hmToMinutes(startHm);
    const endMinutes = hmToMinutes(endHm);
    if (startMinutes === null || endMinutes === null) {
      setLocalError(messages.shiftPatterns.errors.invalid_minutes);
      return;
    }
    const breakMinutes = Number(breakMinutesText);
    if (!Number.isInteger(breakMinutes) || breakMinutes < 0) {
      setLocalError(messages.shiftPatterns.errors.invalid_break_minutes);
      return;
    }
    onSubmit({ name, dayType, startMinutes, endMinutes, breakMinutes });
  }

  return (
    <div className="k-modal__backdrop" onClick={onCancel}>
      <div
        className="k-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="shift-pattern-form-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="k-modal__header">
          <h2 id="shift-pattern-form-title" className="k-modal__title">
            {messages.shiftPatterns.formTitle}
          </h2>
          <button type="button" className="k-modal__close" onClick={onCancel} aria-label={messages.corrections.close}>
            ×
          </button>
        </div>
        <form className="k-modal__body" onSubmit={handleSubmit}>
          <div className="correction-field">
            <label htmlFor="shift-pattern-name">{messages.shiftPatterns.nameLabel}</label>
            <input
              id="shift-pattern-name"
              ref={nameRef}
              type="text"
              value={name}
              placeholder={messages.shiftPatterns.namePlaceholder}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>

          <div className="correction-field">
            <label htmlFor="shift-pattern-day-type">{messages.shiftPatterns.dayTypeLabel}</label>
            <select id="shift-pattern-day-type" value={dayType} onChange={(e) => setDayType(e.target.value as ShiftDayType)}>
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
                <label htmlFor="shift-pattern-start">{messages.shiftPatterns.startLabel}</label>
                <input id="shift-pattern-start" type="time" value={startHm} onChange={(e) => setStartHm(e.target.value)} required />
              </div>
              <div className="correction-field">
                <label htmlFor="shift-pattern-end">{messages.shiftPatterns.endLabel}</label>
                <input id="shift-pattern-end" type="time" value={endHm} onChange={(e) => setEndHm(e.target.value)} required />
                <span className="attendance-settings__field-hint">{messages.shiftPatterns.endHint}</span>
              </div>
              <div className="correction-field">
                <label htmlFor="shift-pattern-break">{messages.shiftPatterns.breakLabel}</label>
                <input
                  id="shift-pattern-break"
                  type="number"
                  min={0}
                  value={breakMinutesText}
                  onChange={(e) => setBreakMinutesText(e.target.value)}
                  required
                />
              </div>
            </>
          ) : null}

          {localError || error ? (
            <p className="correction-error" role="alert">
              {localError ?? error}
            </p>
          ) : null}

          <div className="k-modal__footer">
            <button type="button" className="k-modal__cancel" onClick={onCancel} disabled={pending}>
              {messages.shiftPatterns.cancel}
            </button>
            <button type="submit" className="k-modal__confirm k-modal__confirm--neutral" disabled={pending}>
              {pending ? messages.shiftPatterns.submitting : messages.shiftPatterns.submit}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/** 表示専用のヘルパー(一覧の「時間」列)。dayType が work 以外なら空文字。 */
export function formatShiftPatternTime(dayType: ShiftDayType, startMinutes: number, endMinutes: number): string {
  if (dayType !== "work") return "";
  return `${minutesToHm(startMinutes)} → ${minutesToHm(endMinutes)}`;
}
