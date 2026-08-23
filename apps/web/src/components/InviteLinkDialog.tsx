"use client";

import { useEffect, useState } from "react";
import { messages } from "../lib/messages";
import { formatDateTimeJst } from "../lib/time";

export interface InviteLinkDialogProps {
  memberName: string;
  memberEmail: string;
  /** 平文トークン(表示できるのはこの画面のみ)。 */
  token: string;
  /** UTC エポック分。 */
  expiresAt: number;
  onClose: () => void;
  /**
   * 文言と生成URLのパスだけを切り替える(2026-08-23 Tier 0 その4 追加)。既定は "invite"。
   * 判断点: パスワードリセットの一度きりリンク提示は招待リンク提示と全く同じ構成
   * (平文は1度だけ・閉じると二度と表示できない旨の強調枠・コピー導線)のため、
   * 別コンポーネントを新設せずこのダイアログを文言差し替えのみで共用する(依頼どおり)。
   */
  variant?: "invite" | "reset";
}

interface DialogCopy {
  title: string;
  targetPrefix: string;
  warning: string;
  urlLabel: string;
  copy: string;
  copied: string;
  copyFailed: string;
  expiresLabel: string;
  done: string;
}

function copyFor(variant: "invite" | "reset"): DialogCopy {
  if (variant === "reset") {
    return {
      title: messages.members.resetLinkTitle,
      targetPrefix: messages.members.resetLinkTargetPrefix,
      warning: messages.members.resetLinkWarning,
      urlLabel: messages.members.resetLinkLabel,
      copy: messages.members.resetLinkCopy,
      copied: messages.members.resetLinkCopied,
      copyFailed: messages.members.resetLinkCopyFailed,
      expiresLabel: messages.members.resetLinkExpiresLabel,
      done: messages.members.resetLinkDone,
    };
  }
  return {
    title: messages.members.inviteLinkTitle,
    targetPrefix: messages.members.inviteLinkTargetPrefix,
    warning: messages.members.inviteLinkWarning,
    urlLabel: messages.members.inviteLinkLabel,
    copy: messages.members.inviteLinkCopy,
    copied: messages.members.inviteLinkCopied,
    copyFailed: messages.members.inviteLinkCopyFailed,
    expiresLabel: messages.members.inviteLinkExpiresLabel,
    done: messages.members.inviteLinkDone,
  };
}

/**
 * 一度きりのリンク提示画面(モーダル)。メンバー招待・招待の再発行・パスワードリセットの発行の
 * 直後に共通で使う。APIキー発行(ApiKeysSettingsView)と同じ作法: 平文の値はこの画面でしか見えず、
 * 閉じると二度と表示されない旨を明示する。
 *
 * 完成URLはAPIが組み立てないため(apps/api/src/routes/members.ts のコメント参照)、
 * ここで location.origin から組み立てる。
 */
export function InviteLinkDialog({ memberName, memberEmail, token, expiresAt, onClose, variant = "invite" }: InviteLinkDialogProps) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const path = variant === "reset" ? "reset" : "invite";
  const url = typeof window !== "undefined" ? `${window.location.origin}/${path}/${token}` : "";
  const copy = copyFor(variant);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  }

  return (
    <div className="k-modal__backdrop" onClick={onClose}>
      <div
        className="k-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="invite-link-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="k-modal__header">
          <h2 id="invite-link-title" className="k-modal__title">
            {copy.title}
          </h2>
          <button type="button" className="k-modal__close" onClick={onClose} aria-label={messages.corrections.close}>
            ×
          </button>
        </div>

        <div className="k-modal__body">
          <p className="invite-link__target">
            {copy.targetPrefix}
            {memberName}({memberEmail})
          </p>

          <section className="invite-link__reveal" aria-live="polite">
            <p className="invite-link__warning">{copy.warning}</p>

            <div className="correction-field">
              <label htmlFor="invite-link-url">{copy.urlLabel}</label>
              <div className="invite-link__row">
                <code id="invite-link-url" className="invite-link__url">
                  {url}
                </code>
                <button type="button" className="k-modal__confirm k-modal__confirm--neutral" onClick={handleCopy}>
                  {copyState === "copied" ? copy.copied : copy.copy}
                </button>
              </div>
              {copyState === "failed" ? (
                <p className="correction-error" role="alert">
                  {copy.copyFailed}
                </p>
              ) : null}
            </div>

            <p className="invite-link__expires">
              {copy.expiresLabel}: {formatDateTimeJst(expiresAt)}
            </p>
          </section>
        </div>

        <div className="k-modal__footer">
          <button type="button" className="k-modal__confirm k-modal__confirm--neutral" onClick={onClose}>
            {copy.done}
          </button>
        </div>
      </div>
    </div>
  );
}
