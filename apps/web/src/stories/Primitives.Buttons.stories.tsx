import type { Meta, StoryObj } from "@storybook/react";
import { messages } from "../lib/messages";

/**
 * 主要ボタン型のカタログ。実クラス(punch-home.css の .punch-button、corrections.css の
 * .k-modal__confirm/.k-modal__cancel)をそのまま使い、マークアップは components/PunchHome.tsx・
 * components/MonthlyView.tsx・components/ConfirmDialog.tsx の実際の JSX と同じ形にする。
 */
function ButtonsCatalog() {
  return (
    <div className="story-section">
      <div>
        <h1 className="story-section__title">Primitives / Buttons</h1>
        <p className="story-section__lead">
          打刻ボタン(インキパッド風、CMYK塗り)、通常ボタン(K枠)、危険操作ボタン(締め解除等、
          M塗り固定)。「意味色は状態のみ」の原則どおり、C/M/Yは打刻の3操作にしか使わない。
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
        <p className="story-group__title">通常ボタン / 危険操作ボタン(月次の締め・締め解除)</p>
        <div className="story-row">
          <button type="button" className="k-modal__confirm k-modal__confirm--neutral">
            {messages.closing.closeAction}
          </button>
          <button type="button" className="k-modal__confirm k-modal__confirm--caution">
            {messages.closing.reopenAction}
          </button>
          <button type="button" className="k-modal__cancel">
            {messages.corrections.cancel}
          </button>
        </div>
      </div>
    </div>
  );
}

const meta = {
  title: "プリミティブ/ボタン",
  component: ButtonsCatalog,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof ButtonsCatalog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const AllButtons: Story = { name: "ボタン一覧" };
