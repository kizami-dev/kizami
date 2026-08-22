import { defineConfig } from "vitest/config";

/**
 * apps/api のテストは実際の SQLite に対する統合テスト(打刻を数百件入れて月次を再計算する等)
 * であり、vitest の既定タイムアウト5秒では CI の遅いランナーで落ちる。
 *
 * 2026-08-22: 36協定の「月45h超が年6回を超える」テストが7ヶ月分の打刻を作るため CI で
 * タイムアウトした(ローカルでは通っていた)。個別に timeout を足すと同種の失敗が
 * 出るたびに追記することになるので、このパッケージ全体の既定を上げる。
 */
export default defineConfig({
  test: {
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
