/**
 * packages/db のテストは **同じテストファイルを2つのダイアレクトで走らせる**。
 *
 * - `sqlite` プロジェクト: 従来どおり libSQL(in-memory / 一時ファイル)。常に走る
 * - `postgres` プロジェクト: `TEST_PG_URL` が設定されているときだけ追加される。
 *   未設定の環境(Docker が無い貢献者など)では sqlite レグだけが走り、
 *   下のメッセージで「なぜ PostgreSQL レグが無いのか」を明示する
 *
 * テスト側の分岐は test/support/db.ts に閉じている(テストファイルはダイアレクトを知らない)。
 * ローカルでの走らせ方は docs/design/db-dialects.md 参照。
 */
import { defineConfig } from "vitest/config";

const pgUrl = process.env.TEST_PG_URL;

if (pgUrl === undefined) {
  console.log(
    "[@kizami/db] TEST_PG_URL is not set — running the SQLite leg only.\n" +
      "            To also run the PostgreSQL leg:\n" +
      "              docker run --rm -d -p 15432:5432 -e POSTGRES_PASSWORD=test -e POSTGRES_DB=kizami postgres:17-alpine\n" +
      "              TEST_PG_URL=postgres://postgres:test@localhost:15432/kizami pnpm --filter @kizami/db test",
  );
}

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "sqlite",
          include: ["test/**/*.test.ts"],
          env: { KIZAMI_TEST_DIALECT: "sqlite" },
        },
      },
      ...(pgUrl !== undefined
        ? [
            {
              test: {
                name: "postgres",
                include: ["test/**/*.test.ts"],
                env: { KIZAMI_TEST_DIALECT: "postgres", TEST_PG_URL: pgUrl },
                globalSetup: ["./test/support/pg-global-setup.ts"],
              },
            },
          ]
        : []),
    ],
  },
});
