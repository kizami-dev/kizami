import type { Meta, StoryObj } from "@storybook/react";
import { Button } from "../components/ui/Button";
import { Field } from "../components/ui/Field";
import { Notice } from "../components/ui/Notice";
import { PageHeader } from "../components/ui/PageHeader";
import { StateView } from "../components/ui/StateView";
import { messages } from "../lib/messages";

/**
 * 共通部品(components.css)のカタログ: ページの骨組み・入力欄・注意書き・カード・
 * 読み込み中/空/エラー。実画面と同じ部品(components/ui/*)をそのまま使う。
 */
function FormsNoticesCatalog() {
  return (
    <div className="story-section">
      <div>
        <h1 className="story-section__title">Primitives / Forms &amp; Notices</h1>
        <p className="story-section__lead">
          入力欄は高さ 44px・ラベル 0.85rem/500。注意書きは左罫線とアイコンの形で種類を示す(色だけに頼らない)。
          空の状態にはトンボの線画を1点だけ添える。
        </p>
      </div>

      <div className="story-group">
        <p className="story-group__title">ページの骨組み(PageHeader:見出し・補足・右上の主操作)</p>
        <PageHeader
          title={messages.members.title}
          lead={messages.members.tagline}
          actions={<Button variant="primary">{messages.members.inviteButton}</Button>}
        />
        <div className="page-toolbar">
          <label className="check">
            <input type="checkbox" />
            {messages.members.showInactiveToggle}
          </label>
        </div>
      </div>

      <div className="story-group">
        <p className="story-group__title">入力欄(.field)と カード(.card)</p>
        <form className="card" style={{ maxWidth: "var(--width-form)" }} onSubmit={(e) => e.preventDefault()}>
          <h2 className="card__title">カードの見出し</h2>
          <p className="card__lead">カードの補足。区画の目的を1文で書く。</p>
          <Field label="テキスト" htmlFor="story-text" hint="補足は 0.75rem の ink-soft。">
            <input id="story-text" type="text" placeholder="入力してください" />
          </Field>
          <div className="field-row">
            <Field label="日付" htmlFor="story-date">
              <input id="story-date" type="date" defaultValue="2026-10-05" />
            </Field>
            <Field label="時刻" htmlFor="story-time">
              <input id="story-time" type="time" defaultValue="09:00" />
            </Field>
          </div>
          <Field label="選択" htmlFor="story-select">
            <select id="story-select" defaultValue="b">
              <option value="a">選択肢 A</option>
              <option value="b">選択肢 B</option>
            </select>
          </Field>
          <Field label="エラーのある欄" htmlFor="story-invalid" error="入力内容を確認してください。">
            <input id="story-invalid" type="text" defaultValue="abc" />
          </Field>
          <Field label="無効" htmlFor="story-disabled">
            <input id="story-disabled" type="text" disabled defaultValue="変更できません" />
          </Field>
          <Field label="メモ" htmlFor="story-textarea">
            <textarea id="story-textarea" />
          </Field>
          <label className="check">
            <input type="checkbox" defaultChecked />
            チェックボックス
          </label>
          <div className="btn-row">
            <Button variant="primary" type="submit">
              保存
            </Button>
            <Button variant="secondary">{messages.corrections.cancel}</Button>
          </div>
        </form>
      </div>

      <div className="story-group">
        <p className="story-group__title">注意書き(.notice)</p>
        <div style={{ display: "grid", gap: "var(--space-3)", maxWidth: "var(--width-form)" }}>
          <Notice tone="info">
            情報: 前提や補足。<a href="#notice">文中のリンク</a>も置ける。
          </Notice>
          <Notice tone="caution">注意: この変更は適用開始日以降に効き、過去の集計は変わりません。</Notice>
          <Notice tone="danger" role="alert">
            危険・エラー: この操作を行う権限がありません。
          </Notice>
          <Notice tone="success" role="status">
            完了: 保存しました。
          </Notice>
        </div>
      </div>

      <div className="story-group">
        <p className="story-group__title">読み込み中・空・エラー(StateView)</p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(14rem, 1fr))", gap: "var(--space-3)" }}>
          <div className="card">
            <StateView kind="loading">{messages.loading}</StateView>
          </div>
          <div className="card">
            <StateView kind="empty">{messages.members.empty}</StateView>
          </div>
          <div className="card">
            <StateView kind="error">{messages.errors.network}</StateView>
          </div>
        </div>
      </div>
    </div>
  );
}

const meta = {
  title: "Primitives/Forms & Notices",
  component: FormsNoticesCatalog,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof FormsNoticesCatalog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const AllFormsAndNotices: Story = {};
