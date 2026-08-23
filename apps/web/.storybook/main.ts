import type { StorybookConfig } from "@storybook/react-vite";

/**
 * KIZAMI デザインシステムカタログ(2026-08-23 追加)。
 *
 * apps/web は Waku(独自の Vite/RSC パイプライン、waku.config.ts)で動くが、Storybook は
 * ここで完全に独立した Vite インスタンスを使う(waku.config.ts は import しない)。
 * 依存関係も分離している: waku は `vite` を通常の dependency として自前で持つため
 * (peerDependencies ではない)、apps/web の devDependencies に別途 `vite`(Storybook 8 が
 * 対応する ^5 系)を足しても pnpm 上で2つの vite インスタンスが共存し、waku 側の解決には
 * 影響しない(package.json のコメント参照)。
 */
const config: StorybookConfig = {
  stories: ["../src/stories/**/*.mdx", "../src/stories/**/*.stories.@(ts|tsx)"],
  addons: ["@storybook/addon-essentials"],
  framework: {
    name: "@storybook/react-vite",
    options: {},
  },
  // アプリ本体の public/(favicon・アイコン等)をそのまま静的配信する。
  staticDirs: ["../public"],
  core: {
    disableTelemetry: true,
  },
  docs: {
    defaultName: "Docs",
  },
};

export default config;
