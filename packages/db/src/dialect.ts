/**
 * DATABASE_URL からダイアレクトを判定する。
 *
 * 要件(docs/requirements.md §DB): 「SQLite 既定 + PostgreSQL 選択式」。切り替えは接続 URL
 * だけで行い、設定項目を増やさない(判断点 2026-08-24)。
 */

/** サポートするダイアレクト。 */
export type DbDialect = "sqlite" | "postgres";

/**
 * 接続 URL からダイアレクトを判定する。
 *
 * - `postgres://` / `postgresql://` → "postgres"
 * - `file:` / `libsql:` / `:memory:` / `http(s)://`(libSQL sqld)/ その他 → "sqlite"
 *   (既定が SQLite であること自体が要件なので、未知のスキームは SQLite 扱いにして
 *    @libsql/client 側にエラーを出させる)
 */
export function resolveDialect(url: string | undefined): DbDialect {
  if (url === undefined) return "sqlite";
  const lower = url.trim().toLowerCase();
  return lower.startsWith("postgres://") || lower.startsWith("postgresql://") ? "postgres" : "sqlite";
}
