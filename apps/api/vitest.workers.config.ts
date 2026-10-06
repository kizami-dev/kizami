/**
 * apps/api を **workerd + D1** で起動できることのスモークテスト設定
 * (要件 §8「Workers+D1 動作保証」/ §9 のテストマトリクスの workerd 列)。
 *
 * 本体スイート(test/*.test.ts、700件超)はここでは走らせない。判断点(2026-08-27):
 * それらは test/support/setup.ts が一時ファイルの SQLite を毎テスト作る前提で書かれており、
 * D1 はワーカーごとに1バインディングしか無い(= テストごとに空 DB を作れない)。丸ごと
 * 移植すると全テストのセットアップを書き換えることになり、得られる情報
 * (「ルート層の分岐はランタイムに依存しない」)に対して不相応と判断した。
 * 代わりにここでは **src/workers.ts の実物**(default export)を `SELF` 経由で叩き、
 * ログイン → 打刻 → 勤務状態 → 月次まで通ることを見る。ルート層の網羅は Node レグが持つ。
 *
 * 走らせ方: `pnpm test:workers`(リポジトリルートの vitest.workers.config.ts が束ねる)
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";
import { startFakeSmtpServer } from "./test/workers/support/fake-smtp-server.js";

const here = path.dirname(fileURLToPath(import.meta.url));

// D1 のマイグレーションは SQLite レグと同じ .sql をそのまま使う(packages/db/migrations)。
// 本番では wrangler がデプロイ時に流すもので、ここではテスト用に applyD1Migrations() へ渡す
const migrations = await readD1Migrations(path.join(here, "..", "..", "packages", "db", "migrations"));

// テナントの SMTP を本物の TCP(cloudflare:sockets)で通すための偽のサーバー(Node 側。test/workers/mail.test.ts)
const fakeSmtp = await startFakeSmtpServer();

export default defineConfig({
  plugins: [
    cloudflareTest({
      // 実際に配備するエントリそのものを読み込む(SELF.fetch がこれを叩く)
      main: path.join(here, "src", "workers.ts"),
      miniflare: {
        // apps/api/wrangler.jsonc と揃えること
        compatibilityDate: "2026-08-01",
        compatibilityFlags: ["nodejs_compat"],
        d1Databases: ["DB"],
        bindings: {
          TEST_MIGRATIONS: migrations,
          COOKIE_SECURE: "false",
          TEST_SMTP_PORT: fakeSmtp.smtpPort,
          TEST_SMTP_INBOX_URL: fakeSmtp.inboxUrl,
        },
        // システムメール(Email Service)のバインディング。miniflare は送らずにローカルでシミュレートする
        email: { send_email: [{ name: "EMAIL" }] },
      },
    }),
  ],
  test: {
    name: "workerd:api",
    include: ["test/workers/**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
