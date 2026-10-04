import type { Meta, StoryObj } from "@storybook/react";
import { Button } from "../components/ui/Button";
import { messages } from "../lib/messages";

/**
 * 主要ボタン型のカタログ。打刻ボタン(punch-home.css の .punch-button)と、共通ボタン
 * (components.css の .btn、components/ui/Button.tsx)を実際の JSX と同じ形で並べる。
 */
function ButtonsCatalog() {
  return (
    <div className="story-section">
      <div>
        <h1 className="story-section__title">Primitives / Buttons</h1>
        <p className="story-section__lead">
          打刻ボタン(インキパッド風、CMYK塗り)と共通ボタン。主操作は K 塗り、危険操作は M。
          C/M/Y の塗りは打刻の3操作にしか使わない。無効状態は薄めず、専用の色と破線の枠で示す。
        </p>
      </div>

      <div className="story-group">
        <p className="story-group__title">打刻ボタン(PunchHome の .punch-pad)</p>
        <div className="punch-pad" style={{ maxWidth: "28rem" }}>
          <button type="button" className="punch-button punch-button--in">
            <span>{messages.punchButtons.clockIn}</span>
          </button>
          <button type="button" className="punch-button punch-button--break">
            <span>{messages.punchButtons.breakStart}</span>
          </button>
          <button type="button" className="punch-button punch-button--out">
            <span>{messages.punchButtons.clockOut}</span>
          </button>
        </div>
      </div>

      <div className="story-group">
        <p className="story-group__title">打刻ボタン(disabled)</p>
        <div className="punch-pad" style={{ maxWidth: "28rem" }}>
          <button type="button" className="punch-button punch-button--in" disabled>
            <span>{messages.punchButtons.clockIn}</span>
          </button>
          <button type="button" className="punch-button punch-button--break" disabled>
            <span>{messages.punchButtons.breakStart}</span>
          </button>
          <button type="button" className="punch-button punch-button--out" disabled>
            <span>{messages.punchButtons.clockOut}</span>
          </button>
        </div>
      </div>

      <div className="story-group">
        <p className="story-group__title">共通ボタン(.btn)— 種類</p>
        <div className="btn-row">
          <Button variant="primary">{messages.closing.closeAction}</Button>
          <Button variant="secondary">{messages.corrections.cancel}</Button>
          <Button variant="danger">{messages.closing.reopenAction}</Button>
          <Button variant="danger-ghost">{messages.closing.reopenAction}</Button>
          <Button variant="ghost">{messages.corrections.close}</Button>
        </div>
      </div>

      <div className="story-group">
        <p className="story-group__title">大きさ(sm 36px / md 44px / lg 52px)</p>
        <div className="btn-row">
          <Button variant="primary" size="sm">
            {messages.closing.closeAction}
          </Button>
          <Button variant="primary">{messages.closing.closeAction}</Button>
          <Button variant="primary" size="lg">
            {messages.closing.closeAction}
          </Button>
        </div>
      </div>

      <div className="story-group">
        <p className="story-group__title">無効(--k-disabled-text と破線の枠)</p>
        <div className="btn-row">
          <Button variant="primary" disabled>
            {messages.closing.closeAction}
          </Button>
          <Button variant="secondary" disabled>
            {messages.corrections.cancel}
          </Button>
          <Button variant="danger" disabled>
            {messages.closing.reopenAction}
          </Button>
        </div>
      </div>
    </div>
  );
}

const meta = {
  title: "Primitives/Buttons",
  component: ButtonsCatalog,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof ButtonsCatalog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const AllButtons: Story = {};
