import { defineConfig } from "waku/config";

/**
 * pnpm monorepo では react/react-dom が複数解決されることがあり、
 * RSC 実行環境が "react-server" 条件付きの react を取得できず
 * `The "react-server" condition must be enabled` エラーになることがある
 * (waku 公式 monorepo ガイド推奨の回避策)。
 */
export default defineConfig({
  vite: {
    resolve: {
      dedupe: ["react", "react-dom"],
    },
  },
});
