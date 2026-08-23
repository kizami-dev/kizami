import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { HelpTip } from "../components/HelpTip";
import { messages } from "../lib/messages";

/**
 * HelpTip(実コンポーネント)と ConfirmDialog の型。
 *
 * HelpTip は GET /help/overrides(useHelpOverrides)を叩くが、Storybook には apps/api が
 * 無いためリクエストは失敗する — ただし lib/useHelpOverrides.ts はその失敗を catch して
 * 「社内規定なし」の空状態にフォールバックする設計なので、法令/KIZAMIの仕様バッジは
 * 問題なく表示できる(company バッジ付きの「自社の規定」節だけは、実際のテナント設定が
 * ある環境でしか出せない — アプリ本体は無改修のため、ここでは注記に留める)。
 */
function HelpTipDemo() {
  return (
    <div className="story-section">
      <div>
        <h1 className="story-section__title">Patterns / HelpTip &amp; Dialog</h1>
        <p className="story-section__lead">
          出所バッジ(法令 / KIZAMIの仕様 / 自社の規定)を必ず併記するコンテキストヘルプ
          (docs/design/ui-direction.md「ガイド・ヘルプの方針」)。クリックで開閉する。
        </p>
      </div>
      <div className="story-row story-row--center">
        <span>
          {messages.monthly.columnBreak}
          <HelpTip helpKey="attendance.auto-break" />
        </span>
        <span>
          {messages.monthly.workSystemLabel}
          <HelpTip helpKey="attendance.work-system" />
        </span>
        <span>
          {messages.closing.reopenAction}
          <HelpTip helpKey="closing.unlock" />
        </span>
      </div>
    </div>
  );
}

/** ConfirmDialog(締め解除など影響の大きい操作の確認モーダル)。tone: neutral/caution の型。 */
function ConfirmDialogDemo({ tone }: { tone: "neutral" | "caution" }) {
  const [open, setOpen] = useState(true);
  const [note, setNote] = useState("");

  if (!open) {
    return (
      <div className="story-section">
        <button type="button" className="k-modal__confirm k-modal__confirm--neutral" onClick={() => setOpen(true)}>
          {messages.closing.reopenAction}
        </button>
      </div>
    );
  }

  const isCaution = tone === "caution";
  return (
    <ConfirmDialog
      title={isCaution ? messages.closing.confirmReopenTitle : messages.closing.confirmCloseTitle}
      message={isCaution ? messages.closing.confirmReopenMessage : messages.closing.confirmCloseMessage}
      extraNote={isCaution ? messages.closing.confirmReopenExtraNote : undefined}
      confirmLabel={isCaution ? messages.closing.confirmReopenLabel : messages.closing.confirmCloseLabel}
      tone={tone}
      note={note}
      onNoteChange={setNote}
      noteLabel={messages.closing.noteLabel}
      notePlaceholder={messages.closing.notePlaceholder}
      pending={false}
      error={null}
      onConfirm={() => setOpen(false)}
      onCancel={() => setOpen(false)}
    />
  );
}

const meta = {
  title: "パターン/HelpTip とダイアログ",
  parameters: { layout: "fullscreen" },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const ContextualHelp: Story = {
  name: "コンテキストヘルプ",
  render: () => <HelpTipDemo />,
};

export const ConfirmDialogNeutral: Story = {
  name: "確認ダイアログ(通常)",
  render: () => <ConfirmDialogDemo tone="neutral" />,
};

export const ConfirmDialogCaution: Story = {
  name: "確認ダイアログ(危険操作)",
  render: () => <ConfirmDialogDemo tone="caution" />,
};
