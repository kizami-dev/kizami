"use client";

import { useEffect, useState } from "react";
import type { IssuedInvitationDto } from "../lib/api";
import { messages } from "../lib/messages";
import { formatDateTimeJst } from "../lib/time";

export interface InviteLinkDialogProps {
  memberName: string;
  memberEmail: string;
  invitation: IssuedInvitationDto;
  onClose: () => void;
}

/**
 * 招待リンクの提示画面(モーダル)。メンバー招待・招待の再発行の直後に共通で使う。
 * APIキー発行(ApiKeysSettingsView)と同じ作法: 平文の値はこの画面でしか見えず、
 * 閉じると二度と表示されない旨を明示する。
 *
 * 完成URLはAPIが組み立てないため(apps/api/src/routes/members.ts のコメント参照)、
 * ここで location.origin から組み立てる。
 */
export function InviteLinkDialog({ memberName, memberEmail, invitation, onClose }: InviteLinkDialogProps) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const url = typeof window !== "undefined" ? `${window.location.origin}/invite/${invitation.token}` : "";

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
            {messages.members.inviteLinkTitle}
          </h2>
          <button type="button" className="k-modal__close" onClick={onClose} aria-label={messages.corrections.close}>
            ×
          </button>
        </div>

        <div className="k-modal__body">
          <p className="invite-link__target">
            {messages.members.inviteLinkTargetPrefix}
            {memberName}({memberEmail})
          </p>

          <section className="invite-link__reveal" aria-live="polite">
            <p className="invite-link__warning">{messages.members.inviteLinkWarning}</p>

            <div className="correction-field">
              <label htmlFor="invite-link-url">{messages.members.inviteLinkLabel}</label>
              <div className="invite-link__row">
                <code id="invite-link-url" className="invite-link__url">
                  {url}
                </code>
                <button type="button" className="k-modal__confirm k-modal__confirm--neutral" onClick={handleCopy}>
                  {copyState === "copied" ? messages.members.inviteLinkCopied : messages.members.inviteLinkCopy}
                </button>
              </div>
              {copyState === "failed" ? (
                <p className="correction-error" role="alert">
                  {messages.members.inviteLinkCopyFailed}
                </p>
              ) : null}
            </div>

            <p className="invite-link__expires">
              {messages.members.inviteLinkExpiresLabel}: {formatDateTimeJst(invitation.expiresAt)}
            </p>
          </section>
        </div>

        <div className="k-modal__footer">
          <button type="button" className="k-modal__confirm k-modal__confirm--neutral" onClick={onClose}>
            {messages.members.inviteLinkDone}
          </button>
        </div>
      </div>
    </div>
  );
}
