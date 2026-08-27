/**
 * workerd(Cloudflare Workers ランタイム)レグのテスト設定 — `pnpm test:workers` の実体。
 *
 * 要件 §9 のテストマトリクスにある「Node と workerd の両方で同一スイート」を満たすための
 * 2本目の脚。既定の `pnpm test` は従来どおり Node 上で全パッケージを走らせる(このファイルは
 * それに一切干渉しない)。ここでは **同じテストファイル** を @cloudflare/vitest-pool-workers の
 * プールで走らせ、実行環境を workerd に差し替える。
 *
 * 収録範囲(2026-08-27 時点の判断。docs/design/workers-d1.md「CI カバレッジ」):
 * - ランタイム非依存を謳っているパッケージ(engine / crypto / notify / law / leave / authz)は
 *   **テストを丸ごと** workerd で走らせる。ここが緑でなくなったら「ランタイム非依存」が壊れている
 * - @kizami/db は D1 バインディング向けの専用レグ(packages/db/vitest.d1.config.ts)。
 *   libSQL/pg のドライバは workerd で動かないため、同一スイートではなく D1 用のテストを持つ
 * - apps/api は起動経路のスモーク(apps/api/vitest.workers.config.ts)。本体スイート 700 件超は
 *   一時ファイル SQLite 前提のヘルパに依存しており、workerd へ丸ごと持ち込むのは不相応と判断した
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * ランタイム非依存パッケージ(node:* も外部ランタイム依存も持たない)。
 * これらは Node レグと **同じ include** で workerd 上でも走る。
 */
const RUNTIME_AGNOSTIC_PACKAGES = ["engine", "crypto", "notify", "law", "leave", "authz"] as const;

/** apps/api/wrangler.jsonc と揃えること(挙動差を CI とデプロイで出さないため)。 */
const COMPATIBILITY_DATE = "2026-08-01";

export default defineConfig({
  test: {
    projects: [
      ...RUNTIME_AGNOSTIC_PACKAGES.map((name) => ({
        plugins: [
          cloudflareTest({
            miniflare: {
              compatibilityDate: COMPATIBILITY_DATE,
              compatibilityFlags: ["nodejs_compat"],
            },
          }),
        ],
        test: {
          name: `workerd:${name}`,
          root: path.join(here, "packages", name),
          include: ["test/**/*.test.ts"],
        },
      })),
      "./packages/db/vitest.d1.config.ts",
      "./apps/api/vitest.workers.config.ts",
    ],
  },
});
