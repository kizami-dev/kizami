/**
 * KIZAMI DB レイヤ — **ランタイム非依存のエントリ**(SQLite / PostgreSQL / Cloudflare D1)。
 *
 * - 規約: テーブル・カラムは snake_case。PK は text の UUIDv7(アプリ側生成)。
 *   時刻カラムは UTC エポック分の integer。日付は "YYYY-MM-DD" text
 * - packages/engine への依存・逆依存は禁止(独立レイヤ)
 * - ダイアレクトは DATABASE_URL のスキームだけで決まる(`postgres://` なら PostgreSQL、
 *   それ以外は SQLite/libSQL)。設計は docs/design/db-dialects.md
 * - **接続の生成(`createDatabase` / `migrateDb`)は `@kizami/db/node` にある**。
 *   @libsql/client と pg が node:net / node:fs に依存していて workerd ではバンドルできないため、
 *   Node 専用の面をサブパスへ分けてある(2026-08-27、要件 §8)。Cloudflare Workers からは
 *   このエントリ + `createD1Database(env.DB)` を使う。設計は docs/design/workers-d1.md
 */

export * from "./alias.js";
export * from "./d1.js";
export * from "./dialect.js";
export * from "./errors.js";
export * from "./queries/index.js";
export * from "./schema/index.js";
export * as schema from "./schema/index.js";
export * from "./types.js";
export * from "./uuid.js";
