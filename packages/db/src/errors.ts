/**
 * DB エラーの判定ヘルパ(SQLite/@libsql と PostgreSQL/node-postgres の両対応)。
 *
 * apps/api 層が `@libsql/client` に直接依存せずに「UNIQUE 制約違反か」を判定できるよう、
 * ここでダックタイピングする(@libsql/client の `LibsqlError#code` は
 * "SQLITE_CONSTRAINT" または "SQLITE_CONSTRAINT_UNIQUE" 等になる)。
 *
 * drizzle-orm はクエリ失敗時、元の LibsqlError を `cause` に包んだ汎用 Error
 * ("Failed query: ...")を投げる。`code` はそちらの `cause`(さらにその `cause` の場合もある)
 * に付いているため、数段階だけ `cause` を辿って判定する。
 *
 * PostgreSQL(node-postgres)は同じ違反を SQLSTATE "23505"(unique_violation)で返す。
 * ダイアレクトを呼び出し側に漏らさないため、ここで両方のコードを見る(2026-08-24)。
 *
 * 用途: punch_events.supersedes_id の UNIQUE インデックス違反(同一イベントの二重無効化)を、
 * 修正申請の承認処理(apps/api/src/routes/corrections.ts)が 409 として扱うために使う。
 */
export function isUniqueConstraintError(err: unknown): boolean {
  let current: unknown = err;
  for (let depth = 0; depth < 5 && current !== undefined && current !== null; depth++) {
    if (
      current instanceof Error &&
      "code" in current &&
      typeof (current as { code?: unknown }).code === "string" &&
      isUniqueViolationCode((current as { code: string }).code)
    ) {
      return true;
    }
    current = current instanceof Error ? current.cause : undefined;
  }
  return false;
}

/** SQLite の "SQLITE_CONSTRAINT*" と PostgreSQL の "23505"(unique_violation)。 */
function isUniqueViolationCode(code: string): boolean {
  return code.startsWith("SQLITE_CONSTRAINT") || code === "23505";
}
