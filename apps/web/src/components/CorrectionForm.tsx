"use client";

import { useEffect, useRef, useState } from "react";
import { api, ApiError, UnauthorizedError, type Punch, type PunchKind } from "../lib/api";
import { mapCorrectionErrorMessage, messages } from "../lib/messages";
import { dateWindowJst, formatDateLabel, formatTimeJst, toEpochMinutesJst } from "../lib/time";

const PUNCH_KIND_OPTIONS: PunchKind[] = ["clock_in", "break_start", "break_end", "clock_out"];
const MAX_REASON_LENGTH = 500;

type Mode = "add" | "correct" | "cancel";

export interface CorrectionFormProps {
  date: string;
  onClose: () => void;
  onSubmitted: () => void;
  /** UnauthorizedError 発生時、呼び出し元(MonthlyView)に /login への誘導を委ねる。 */
  onUnauthorized: () => void;
}

/**
 * 月次画面の各日行から開く、打刻修正申請フォーム(モーダル)。
 * docs/design/ui-direction.md の方針: 遊びは打刻画面のみ、それ以外(この画面含む)は明瞭優先。
 */
export function CorrectionForm({ date, onClose, onSubmitted, onUnauthorized }: CorrectionFormProps) {
  const [punches, setPunches] = useState<Punch[] | null>(null);
  const [loadError, setLoadError] = useState(false);

  const [mode, setMode] = useState<Mode>("add");
  const [targetEventId, setTargetEventId] = useState("");
  const [kind, setKind] = useState<PunchKind>("clock_out");
  const [time, setTime] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const firstFieldRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let cancelled = false;
    const { from, to } = dateWindowJst(date);
    api
      .listPunches(from, to)
      .then((res) => {
        if (!cancelled) setPunches(res.punches);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof UnauthorizedError) {
          onUnauthorized();
          return;
        }
        setLoadError(true);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  useEffect(() => {
    firstFieldRef.current?.focus();
  }, []);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  function handleSelectTarget(id: string) {
    setTargetEventId(id);
    const target = punches?.find((p) => p.id === id);
    if (target) {
      setKind(target.kind);
      setTime(formatTimeJst(target.occurredAt));
    }
  }

  function handleModeChange(next: Mode) {
    setMode(next);
    setFormError(null);
    if (next === "add") {
      setTargetEventId("");
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);

    if (reason.length < 1 || reason.length > MAX_REASON_LENGTH) {
      setFormError(messages.corrections.errors.invalid_reason);
      return;
    }

    if (mode === "cancel") {
      if (!targetEventId) {
        setFormError(messages.corrections.errors.invalid_target_event);
        return;
      }
    } else {
      if (mode === "correct" && !targetEventId) {
        setFormError(messages.corrections.errors.invalid_target_event);
        return;
      }
      if (!time) {
        setFormError(messages.corrections.errors.invalid_proposed_occurred_at);
        return;
      }
    }

    let body: Parameters<typeof api.createCorrection>[0];
    if (mode === "add") {
      const occurredAt = toEpochMinutesJst(date, time);
      if (occurredAt === null) {
        setFormError(messages.corrections.errors.invalid_proposed_occurred_at);
        return;
      }
      body = { proposedKind: kind, proposedOccurredAt: occurredAt, reason };
    } else if (mode === "correct") {
      const occurredAt = toEpochMinutesJst(date, time);
      if (occurredAt === null) {
        setFormError(messages.corrections.errors.invalid_proposed_occurred_at);
        return;
      }
      body = { targetEventId, proposedKind: kind, proposedOccurredAt: occurredAt, reason };
    } else {
      body = { targetEventId, reason };
    }

    setSubmitting(true);
    try {
      await api.createCorrection(body);
      onSubmitted();
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        onUnauthorized();
        return;
      }
      setFormError(err instanceof ApiError ? mapCorrectionErrorMessage(err.body) : messages.errors.network);
    } finally {
      setSubmitting(false);
    }
  }

  const hasPunches = (punches?.length ?? 0) > 0;

  return (
    <div className="k-modal__backdrop" onClick={onClose}>
      <div
        className="k-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="correction-form-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="k-modal__header">
          <h2 id="correction-form-title" className="k-modal__title">
            {formatDateLabel(date)}
            {messages.corrections.formTitle}
          </h2>
          <button type="button" className="k-modal__close" onClick={onClose} aria-label={messages.corrections.close}>
            ×
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="k-modal__body">
            <p className="correction-form__hint">{messages.corrections.formHint}</p>

            <section className="correction-form__section">
              <p className="correction-form__section-title">{messages.corrections.currentPunchesTitle}</p>
              {loadError ? <p className="correction-error">{messages.errors.loadFailed}</p> : null}
              {punches === null && !loadError ? <p className="correction-form__loading">{messages.loading}</p> : null}
              {punches !== null && !hasPunches ? (
                <p className="correction-form__empty">{messages.corrections.currentPunchesEmpty}</p>
              ) : null}
              {punches && hasPunches ? (
                <ul className="correction-punch-list">
                  {punches.map((p) => (
                    <li key={p.id} className="correction-punch-list__item">
                      <span>{messages.punchKindLabel[p.kind]}</span>
                      <span className="tabular-nums">{formatTimeJst(p.occurredAt)}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>

            <section className="correction-form__section">
              <div className="correction-mode" role="radiogroup" aria-label="操作の種類">
                <button
                  type="button"
                  ref={firstFieldRef}
                  role="radio"
                  aria-checked={mode === "add"}
                  className={`correction-mode__btn${mode === "add" ? " correction-mode__btn--active" : ""}`}
                  onClick={() => handleModeChange("add")}
                >
                  {messages.corrections.modeAdd}
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={mode === "correct"}
                  className={`correction-mode__btn${mode === "correct" ? " correction-mode__btn--active" : ""}`}
                  onClick={() => handleModeChange("correct")}
                >
                  {messages.corrections.modeCorrect}
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={mode === "cancel"}
                  className={`correction-mode__btn${mode === "cancel" ? " correction-mode__btn--active" : ""}`}
                  onClick={() => handleModeChange("cancel")}
                >
                  {messages.corrections.modeCancel}
                </button>
              </div>

              {mode === "correct" || mode === "cancel" ? (
                <div className="correction-field">
                  <label htmlFor="correction-target">{messages.corrections.targetLabel}</label>
                  {hasPunches ? (
                    <select
                      id="correction-target"
                      value={targetEventId}
                      onChange={(e) => handleSelectTarget(e.target.value)}
                      required
                    >
                      <option value="" disabled>
                        {messages.corrections.targetPlaceholder}
                      </option>
                      {punches?.map((p) => (
                        <option key={p.id} value={p.id}>
                          {messages.punchKindLabel[p.kind]} {formatTimeJst(p.occurredAt)}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <p className="correction-form__empty">{messages.corrections.targetEmpty}</p>
                  )}
                </div>
              ) : null}

              {mode === "add" || mode === "correct" ? (
                <div className="correction-field-row">
                  <div className="correction-field">
                    <label htmlFor="correction-kind">{messages.corrections.kindLabel}</label>
                    <select id="correction-kind" value={kind} onChange={(e) => setKind(e.target.value as PunchKind)}>
                      {PUNCH_KIND_OPTIONS.map((k) => (
                        <option key={k} value={k}>
                          {messages.punchKindLabel[k]}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="correction-field">
                    <label htmlFor="correction-time">{messages.corrections.timeLabel}</label>
                    <input
                      id="correction-time"
                      type="time"
                      value={time}
                      onChange={(e) => setTime(e.target.value)}
                      required
                    />
                  </div>
                </div>
              ) : null}

              <div className="correction-field">
                <label htmlFor="correction-reason">{messages.corrections.reasonLabel}</label>
                <textarea
                  id="correction-reason"
                  value={reason}
                  maxLength={MAX_REASON_LENGTH}
                  placeholder={messages.corrections.reasonPlaceholder}
                  onChange={(e) => setReason(e.target.value)}
                  required
                />
                <span className="correction-field__counter tabular-nums">
                  {reason.length}/{MAX_REASON_LENGTH}
                </span>
              </div>

              {formError ? (
                <p className="correction-error" role="alert">
                  {formError}
                </p>
              ) : null}
            </section>
          </div>

          <div className="k-modal__footer">
            <button type="button" className="k-modal__cancel" onClick={onClose} disabled={submitting}>
              {messages.corrections.cancel}
            </button>
            <button type="submit" className="k-modal__confirm k-modal__confirm--neutral" disabled={submitting}>
              {submitting ? messages.corrections.submitting : messages.corrections.submit}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
