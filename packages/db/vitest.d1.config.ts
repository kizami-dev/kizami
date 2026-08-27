/**
 * @kizami/db を **Cloudflare D1** で走らせるレグ(要件 §9 の3ダイアレクト目)。
 *
 * `pnpm test` は従来どおり Node 上の SQLite/PostgreSQL レグだけを走らせる(vitest.config.ts)。
 * このファイルは `pnpm test:workers`(リポジトリルートの vitest.workers.config.ts)から
 * 呼ばれ、**同じ test/*.test.ts を workerd + D1 で**走らせる。
 *
 * 仕掛けは1点だけ: 全テストが DB を作るのに使う `./support/db.js` を D1 版
 * (support/db.d1.ts)へ alias で差し替える。テストファイル自体はダイアレクトを知らない
 * (Node レグで PostgreSQL に切り替えているのと同じ設計)。
 *
 * D1 で走らせない除外リストは EXCLUDED_ON_D1 を参照(理由もそこに書いてある)。
 * Docker 不要・ローカルで完結する(workerd を miniflare が起動するだけ)ので、
 * PostgreSQL レグと違って環境変数によるゲートは設けていない。
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

const here = path.dirname(fileURLToPath(import.meta.url));

// D1 は SQLite 互換なので migrations/*.sql をそのまま流せる(migrations-pg/ は使わない)
const migrations = await readD1Migrations(path.join(here, "migrations"));

/**
 * D1 で走らせないテスト。**「D1 では動かない」ものだけを列挙する**(足すときは理由を書くこと)。
 */
const EXCLUDED_ON_D1 = [
  // pg / @libsql/client のドライバを直接 import して SQL 文字列を突き合わせるテスト。
  // ドライバごと workerd で動かないため Node レグ専用(D1 の SQL 生成が libSQL と一致することは
  // 同ファイルの Node レグ側で toSQL() 比較として見ている)
  "test/dialect-portability.test.ts",
  // drizzle-kit が生成した migrations-pg/*.sql を node:fs で読む PostgreSQL 専用テスト
  "test/migrations-pg.test.ts",
  // sqlite-core / pg-core のスキーマ定義同士を突き合わせる drift 検査。実 DB を一切使わない
  // 静的検査なので、D1 で回しても得られる情報が無い(Node レグで毎回走っている)
  "test/schema-drift.test.ts",
];

export default defineConfig({
  plugins: [
    cloudflareTest({
      miniflare: {
        // apps/api/wrangler.jsonc と揃えること
        compatibilityDate: "2026-08-01",
        compatibilityFlags: ["nodejs_compat"],
        d1Databases: ["DB"],
        bindings: { TEST_MIGRATIONS: migrations },
      },
    }),
  ],
  resolve: {
    alias: [
      // 全テストがこの1本を通って DB を作る。D1 版へ差し替えるのはここだけ
      { find: /^\.\/support\/db\.js$/, replacement: path.join(here, "test", "support", "db.d1.ts") },
    ],
  },
  test: {
    name: "d1",
    include: ["test/**/*.test.ts"],
    exclude: EXCLUDED_ON_D1,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
