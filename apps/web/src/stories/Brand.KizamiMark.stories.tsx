import type { Meta, StoryObj } from "@storybook/react";
import { KizamiMark } from "../components/KizamiMark";

/**
 * ロゴマーク(トンボ+時計の針、docs/design/ui-direction.md「ロゴとアイコン」節)のサイズ展開。
 * `KizamiMark.tsx` を直接 import する(アプリ本体は無変更)。K に相当する部分は currentColor
 * のためテキスト色に追従する(ダーク切り替えで確認できる)。
 */
function SizeVariants() {
  const sizes = [16, 24, 44, 64] as const;
  return (
    <div className="story-section">
      <div>
        <h1 className="story-section__title">Brand / KizamiMark</h1>
        <p className="story-section__lead">
          トンボ(見当合わせマーク)+時計の針。12時の腕が K、右回りに C(3時)→M(6時)→Y(9時)。
          小さいサイズほど線を太く、腕をわずかに外へ伸ばす3段階のバケットを持つ
          (KizamiMark.tsx の pickBucket)。座標・色・角度は変更禁止(ui-direction.md)。
        </p>
      </div>
      <div className="story-row story-row--center">
        {sizes.map((size) => (
          <div key={size} className="story-type-sample">
            <KizamiMark size={size} />
            <span className="story-type-sample__label">{size}px</span>
          </div>
        ))}
      </div>
    </div>
  );
}

const meta = {
  title: "Brand/KizamiMark",
  component: SizeVariants,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof SizeVariants>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Sizes: Story = {};
