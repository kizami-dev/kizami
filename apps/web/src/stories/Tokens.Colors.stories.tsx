import type { Meta, StoryObj } from "@storybook/react";
import { useEffect, useRef, useState } from "react";

/**
 * デザイントークン(色)のカタログ(docs/design/ui-direction.md「カラートークン」節)。
 *
 * 値はハードコピーしない — 各スウォッチは `background: var(--k-xxx)` を実際に指定し、
 * 描画後に `getComputedStyle` で解決済みの色を読み取って表示するだけなので、tokens.css の
 * 値が変わればここも自動で追従する。テーマ切り替え(ツールバー)で実際の値の変化も見える。
 */

interface TokenSwatchProps {
  token: string;
  role: string;
}

function TokenSwatch({ token, role }: TokenSwatchProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [resolved, setResolved] = useState("");

  useEffect(() => {
    if (!ref.current) return;
    setResolved(getComputedStyle(ref.current).backgroundColor);
  });

  return (
    <div className="story-swatch">
      <div ref={ref} className="story-swatch__color" style={{ background: `var(${token})` }} />
      <div className="story-swatch__meta">
        <span className="story-swatch__token">{token}</span>
        <span className="story-swatch__hex">{resolved}</span>
        <p className="story-swatch__role">{role}</p>
      </div>
    </div>
  );
}

function ColorsCatalog() {
  return (
    <div className="story-section">
      <div>
        <h1 className="story-section__title">Tokens / Colors</h1>
        <p className="story-section__lead">
          「印刷所の刻印」コンセプトの CMYK プロセスインキ。原色は塗り・大型要素専用、テキストには AA
          を満たす ink 変種を使う(色のみに意味を持たせない)。ツールバーでダークに切り替えると
          tokens.css の再定義値に自動で切り替わる。
        </p>
      </div>

      <div className="story-group">
        <p className="story-group__title">地・キー</p>
        <div className="story-swatch-grid">
          <TokenSwatch token="--k-paper" role="地。クールな紙白(クリーム系は使わない)" />
          <TokenSwatch token="--k-key" role="K。本文・枠線・主要 UI" />
          <TokenSwatch token="--k-ink-soft" role="二次テキスト" />
        </div>
      </div>

      <div className="story-group">
        <p className="story-group__title">CMY 原色(塗り・大型要素専用)</p>
        <div className="story-swatch-grid">
          <TokenSwatch token="--k-cyan" role="出勤系の塗り・マーク" />
          <TokenSwatch token="--k-magenta" role="退勤系の塗り・マーク" />
          <TokenSwatch token="--k-yellow" role="休憩系の塗り・ハイライト。テキスト使用禁止" />
        </div>
      </div>

      <div className="story-group">
        <p className="story-group__title">ink 変種(テキスト・アイコン線、AA 準拠)</p>
        <div className="story-swatch-grid">
          <TokenSwatch token="--k-cyan-ink" role="出勤系のテキスト・アイコン線" />
          <TokenSwatch token="--k-magenta-ink" role="退勤系のテキスト" />
          <TokenSwatch token="--k-yellow-ink" role="休憩系のテキスト" />
        </div>
      </div>

      <div className="story-group">
        <p className="story-group__title">塗り上テキストの固定色(ダーク対応、2026-08-22 追加)</p>
        <p className="story-group__note">
          原色塗り(シアン・イエロー・危険操作のマゼンタ)の上のテキストは、--k-key/--k-paper が
          ダークで反転してもコントラストが壊れないよう、テーマに関係なく常に安全な固定色を使う。
        </p>
        <div className="story-swatch-grid">
          <TokenSwatch token="--k-fill-text-dark" role="シアン/イエロー原色塗りの上のテキスト(常に暗色)" />
          <TokenSwatch token="--k-fill-text-light" role="マゼンタ系の濃い塗りの上のテキスト(常に明色)" />
          <TokenSwatch token="--k-magenta-fill" role="危険操作ボタン(締め解除等)専用の塗り" />
          <TokenSwatch token="--k-magenta-fill-hover" role="危険操作ボタンの hover" />
        </div>
      </div>

      <div className="story-group">
        <p className="story-group__title">面・状態</p>
        <div className="story-swatch-grid">
          <TokenSwatch token="--k-surface" role="カード面より一段明るい「浮いた」面(入力欄・チップ等)" />
          <TokenSwatch token="--k-disabled-bg" role="打刻ボタン等の disabled 塗り" />
          <TokenSwatch token="--k-key-strong" role="--k-key 塗りボタンの hover(さらに強い方向)" />
          <TokenSwatch token="--k-scrim" role="モーダルの背景幕" />
        </div>
      </div>
    </div>
  );
}

const meta = {
  title: "Tokens/Colors",
  component: ColorsCatalog,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof ColorsCatalog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Palette: Story = {};
