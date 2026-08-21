"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { messages } from "../lib/messages";

export interface ConfirmDialogProps {
  title: string;
  message: ReactNode;
  /** 承認の自己承認注記など、確認文言に追加で添える一文。 */
  extraNote?: ReactNode;
  confirmLabel: string;
  /** 却下・取下げ等、破壊的でない操作向けの警戒色を弱めた表示にするか。 */
  tone?: "neutral" | "caution";
  note: string;
  onNoteChange?: ((value: string) => void) | undefined;
  noteLabel?: string | undefined;
  notePlaceholder?: string | undefined;
  pending: boolean;
  error: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * 影響が画面外に及ぶ操作(承認等)の実行前確認モーダル(要件定義書 §10)。
 * K主体の静かな見た目に統一する(docs/design/ui-direction.md §申請・承認画面)。
 */
export function ConfirmDialog({
  title,
  message,
  extraNote,
  confirmLabel,
  tone = "neutral",
  note,
  onNoteChange,
  noteLabel,
  notePlaceholder,
  pending,
  error,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const confirmButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    confirmButtonRef.current?.focus();
  }, []);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onCancel]);

  return (
    <div className="k-modal__backdrop" onClick={onCancel}>
      <div
        className="k-modal k-modal--confirm"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="k-modal__header">
          <h2 id="confirm-dialog-title" className="k-modal__title">
            {title}
          </h2>
          <button type="button" className="k-modal__close" onClick={onCancel} aria-label={messages.corrections.close}>
            ×
          </button>
        </div>
        <div className="k-modal__body">
          <p className="confirm-dialog__message">{message}</p>
          {extraNote ? <p className="confirm-dialog__extra-note">{extraNote}</p> : null}
          {onNoteChange ? (
            <div className="correction-field">
              <label htmlFor="confirm-dialog-note">{noteLabel}</label>
              <textarea
                id="confirm-dialog-note"
                value={note}
                maxLength={500}
                placeholder={notePlaceholder}
                onChange={(e) => onNoteChange(e.target.value)}
              />
            </div>
          ) : null}
          {error ? (
            <p className="correction-error" role="alert">
              {error}
            </p>
          ) : null}
        </div>
        <div className="k-modal__footer">
          <button type="button" className="k-modal__cancel" onClick={onCancel} disabled={pending}>
            {messages.corrections.cancel}
          </button>
          <button
            type="button"
            ref={confirmButtonRef}
            className={`k-modal__confirm k-modal__confirm--${tone}`}
            onClick={onConfirm}
            disabled={pending}
          >
            {pending ? messages.corrections.submitting : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
