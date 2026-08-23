import type { Meta, StoryObj } from "@storybook/react";
import { messages } from "../lib/messages";

/**
 * タイポグラフィのカタログ(docs/design/ui-direction.md「タイポグラフィ」節)。
 * 実際に使われている書体トークン(--font-display/--font-logo/--font-body/--font-mono)を
 * そのまま参照し、用途どおりの見せ方(状態スタンプ・ロゴ・本文・数値)で型見本を出す。
 */
function TypographyCatalog() {
  return (
    <div className="story-section">
      <div>
        <h1 className="story-section__title">Tokens / Typography</h1>
        <p className="story-section__lead">
          4書体をそれぞれの役割どおりに使う。Display は状態スタンプの文字のみ(多用禁止)、
          Logo は文字ロゴ専用、Body は本文・UI全般、Numerals は時刻・集計数値
          (tabular-nums で桁が揃う)。
        </p>
      </div>

      <div className="story-group">
        <p className="story-group__title">Display — Shippori Antique B1(状態スタンプ専用)</p>
        <div className="story-frame story-frame--center">
          <span style={{ fontFamily: "var(--font-display)", fontSize: "1.6rem", letterSpacing: "0.08em" }}>
            {messages.attendanceState.working}
          </span>
          <span style={{ fontFamily: "var(--font-display)", fontSize: "1.6rem", letterSpacing: "0.08em" }}>
            {messages.attendanceState.onBreak}
          </span>
          <span style={{ fontFamily: "var(--font-display)", fontSize: "1.6rem", letterSpacing: "0.08em" }}>
            {messages.attendanceState.out}
          </span>
        </div>
      </div>

      <div className="story-group">
        <p className="story-group__title">Logo — Jost weight 500 / 字間 0.18em(文字ロゴ「KIZAMI」専用)</p>
        <div className="story-frame">
          <span style={{ fontFamily: "var(--font-logo)", fontWeight: 500, letterSpacing: "0.18em", fontSize: "1.8rem" }}>
            KIZAMI
          </span>
        </div>
      </div>

      <div className="story-group">
        <p className="story-group__title">Body — Zen Kaku Gothic New(本文・UI全般)</p>
        <div className="story-frame">
          {(["400", "500", "700"] as const).map((weight) => (
            <p key={weight} style={{ fontFamily: "var(--font-body)", fontWeight: Number(weight), fontSize: "1rem", margin: 0 }}>
              {messages.login.tagline}({weight})
            </p>
          ))}
        </div>
      </div>

      <div className="story-group">
        <p className="story-group__title">Numerals — IBM Plex Mono(時刻・集計数値、tabular-nums)</p>
        <div className="story-frame">
          <span className="tabular-nums" style={{ fontFamily: "var(--font-mono)", fontSize: "2.2rem", fontWeight: 600 }}>
            12:34:56
          </span>
          <span className="tabular-nums" style={{ fontFamily: "var(--font-mono)", fontSize: "1.4rem" }}>
            177:08
          </span>
        </div>
      </div>
    </div>
  );
}

const meta = {
  title: "Tokens/Typography",
  component: TypographyCatalog,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof TypographyCatalog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const TypeScale: Story = {};
