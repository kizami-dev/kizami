/**
 * KIZAMI DB レイヤ(SQLite 既定 / PostgreSQL 選択式)
 *
 * - 規約: テーブル・カラムは snake_case。PK は text の UUIDv7(アプリ側生成)。
 *   時刻カラムは UTC エポック分の integer。日付は "YYYY-MM-DD" text
 * - packages/engine への依存・逆依存は禁止(独立レイヤ)
 * - ダイアレクトは DATABASE_URL のスキームだけで決まる(`postgres://` なら PostgreSQL、
 *   それ以外は SQLite/libSQL)。設計は docs/design/db-dialects.md
 */

export * from "./alias.js";
export * from "./dialect.js";
export * from "./errors.js";
export * from "./migrate.js";
export * from "./queries/index.js";
export * from "./schema/index.js";
export * as schema from "./schema/index.js";
export * from "./uuid.js";
