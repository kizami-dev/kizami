"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
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
  /**
   * 取り返しのつかない操作で、対象名の**再入力**を求める(2026-08-27 追加、
   * 退職者の個人データ消去 — docs/design/data-retention.md)。
   *
   * 指定すると確認ボタンは入力が `phrase` と完全一致するまで無効のままになる。判断点:
   * 既存の確認ダイアログはボタン1つで実行できるが、消去は元に戻せず、かつ**対象を取り違えても
   * 気づけない**(押した瞬間に氏名が消えるので、後から「誰を消したか」を目で確かめられない)。
   * 対象名を手で写す操作を挟むことで、リストの隣の行を押した事故を止められる。
   * 逆に、取り消せる操作(無効化・招待の取り消し)にこれを付けると単なる摩擦なので付けない。
   */
  confirmPhrase?: { phrase: string; label: string; placeholder: string; mismatchHint: string } | undefined;
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
  confirmPhrase,
}: ConfirmDialogProps) {
  const confirmButtonRef = useRef<HTMLButtonElement>(null);
  const [typedPhrase, setTypedPhrase] = useState("");
  // trim のみ(大文字小文字や全角半角は正規化しない)。氏名の一致判定を緩めると、
  // 似た名前の別人でも通ってしまい、この確認を置いた意味が薄れる。
  const phraseMatches = confirmPhrase === undefined || typedPhrase.trim() === confirmPhrase.phrase;

  const phraseInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // 対象名の再入力を求める場合は入力欄へ、そうでなければ従来どおり確認ボタンへ初期フォーカスする。
    if (confirmPhrase !== undefined) {
      phraseInputRef.current?.focus();
      return;
    }
    confirmButtonRef.current?.focus();
    // confirmPhrase の有無はダイアログの生存中に変わらない(呼び出し側が固定値を渡す)。
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
          {/*
           * div(p ではない): message は ReactNode を許容しており、退職処理の確認(影響の箇条書き)
           * のように <ul> 等のブロック要素を含むケースがある(2026-08-23 Tier 0 その4 で発覚・修正
           * — p の中に ul を置くと「In HTML, <ul> cannot be a descendant of <p>」のハイドレーション
           * エラーになっていた)。confirm-dialog__message の見た目(corrections.css)は div でも同じ。
           */}
          <div className="confirm-dialog__message">{message}</div>
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
          {confirmPhrase ? (
            <div className="correction-field">
              <label htmlFor="confirm-dialog-phrase">{confirmPhrase.label}</label>
              <input
                id="confirm-dialog-phrase"
                ref={phraseInputRef}
                type="text"
                value={typedPhrase}
                autoComplete="off"
                placeholder={confirmPhrase.placeholder}
                onChange={(e) => setTypedPhrase(e.target.value)}
              />
              {typedPhrase !== "" && !phraseMatches ? (
                <p className="confirm-dialog__phrase-hint">{confirmPhrase.mismatchHint}</p>
              ) : null}
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
            disabled={pending || !phraseMatches}
          >
            {pending ? messages.corrections.submitting : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
