/**
 * PostgreSQL 用の drizzle-kit 設定。
 * スキーマは `src/schema-pg/index.ts`(sqlite-core 定義から実行時生成する DDL 専用ミラー)、
 * 出力先は `migrations-pg/`(SQLite 用の `migrations/` とは完全に別系統)。
 *
 * 生成: `pnpm --filter @kizami/db generate:pg`
 */
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema-pg/index.ts",
  out: "./migrations-pg",
});
