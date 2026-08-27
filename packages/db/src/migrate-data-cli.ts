/**
 * SQLite → PostgreSQL データ移行 CLI(`pnpm --filter @kizami/db migrate-data`)。
 *
 * ```sh
 * pnpm --filter @kizami/db migrate-data -- \
 *   --from file:./kizami.db \
 *   --to postgres://kizami:***@localhost:5432/kizami \
 *   --i-stopped-the-app
 * ```
 *
 * 引数(環境変数でも指定できる。引数が優先):
 * - `--from` / `SOURCE_DATABASE_URL`(既定 `file:./kizami.db`)… コピー元。**書き込まない**
 * - `--to`   / `TARGET_DATABASE_URL`(必須)… コピー先の `postgres://…`。**空でなければならない**
 * - `--pg-schema` / `TARGET_PG_SCHEMA` … search_path を切り替えて運用している場合のスキーマ名
 * - `--batch-size`(既定 500)… 1回の INSERT にまとめる行数
 * - `--i-stopped-the-app` … アプリ(api / worker)を停止済みであることの明示。
 *   付けない場合、対話端末なら確認を促し、非対話(CI・Job)なら実行しない
 *
 * 処理の中身と設計判断は src/migrate-data.ts の冒頭コメント、
 * 運用手順は docs/design/db-dialects.md「SQLite → PostgreSQL のデータ移行」節。
 */

import { createInterface } from "node:readline/promises";
import { DEFAULT_BATCH_SIZE, formatMigrationReport, migrateDataToPostgres } from "./migrate-data.js";

/** `--name X` / `--name=X` 形式の引数を読む(apps/api/src/create-tenant.ts と同じ形)。 */
function argValue(argv: string[], flag: string): string | undefined {
  const prefixed = argv.find((a) => a.startsWith(`--${flag}=`));
  if (prefixed) return prefixed.slice(flag.length + 3);
  const index = argv.indexOf(`--${flag}`);
  if (index >= 0) return argv[index + 1];
  return undefined;
}

/** 停止確認。フラグが無いときは対話端末でだけ確認を取る(Job からの誤実行を防ぐ)。 */
async function confirmAppStopped(): Promise<boolean> {
  if (!process.stdin.isTTY) {
    console.error(
      "Refusing to run: pass --i-stopped-the-app to confirm that the KIZAMI api and worker are stopped.\n" +
        "Rows written to SQLite while this tool runs would NOT be copied.",
    );
    return false;
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question("Are the KIZAMI api and worker stopped? Type 'yes' to continue: ");
    return answer.trim().toLowerCase() === "yes";
  } finally {
    rl.close();
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const from = argValue(argv, "from") ?? process.env.SOURCE_DATABASE_URL ?? "file:./kizami.db";
  const to = argValue(argv, "to") ?? process.env.TARGET_DATABASE_URL;
  const pgSchema = argValue(argv, "pg-schema") ?? process.env.TARGET_PG_SCHEMA;
  const batchSizeArg = argValue(argv, "batch-size");
  const stopped = argv.includes("--i-stopped-the-app");

  if (!to) {
    console.error(
      "Usage: pnpm --filter @kizami/db migrate-data -- --from file:./kizami.db --to postgres://user:pass@host:5432/kizami --i-stopped-the-app",
    );
    process.exitCode = 1;
    return;
  }
  if (!to.toLowerCase().startsWith("postgres://") && !to.toLowerCase().startsWith("postgresql://")) {
    console.error(`--to must be a PostgreSQL URL (postgres:// or postgresql://), got: ${to}`);
    process.exitCode = 1;
    return;
  }
  const batchSize = batchSizeArg === undefined ? DEFAULT_BATCH_SIZE : Number(batchSizeArg);
  if (!Number.isInteger(batchSize) || batchSize < 1) {
    console.error(`--batch-size must be a positive integer, got: ${batchSizeArg}`);
    process.exitCode = 1;
    return;
  }

  console.log(
    [
      "",
      "!!!  STOP THE APPLICATION BEFORE RUNNING THIS  !!!",
      "",
      "  This copies the SQLite database into an EMPTY PostgreSQL database.",
      "  The source file is only read (never written), so the rollback is simply:",
      "  keep pointing DATABASE_URL at the SQLite file.",
      "  Anything written to SQLite while this runs is NOT copied.",
      "",
      `  from: ${from}`,
      `  to:   ${to.replace(/:\/\/([^:@/]+):[^@]*@/, "://$1:***@")}${pgSchema === undefined ? "" : ` (schema ${pgSchema})`}`,
      "",
    ].join("\n"),
  );

  if (!stopped && !(await confirmAppStopped())) {
    console.error("aborted");
    process.exitCode = 1;
    return;
  }

  const report = await migrateDataToPostgres({
    from,
    to,
    batchSize,
    ...(pgSchema !== undefined ? { pgSchema } : {}),
  });
  console.log(formatMigrationReport(report));
  console.log(
    "\nmigration complete. Point DATABASE_URL at PostgreSQL and start the app.\n" +
      "Keep the SQLite file around until you have verified the new deployment — it is the rollback.",
  );
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
