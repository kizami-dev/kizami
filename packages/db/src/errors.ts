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
 * Cloudflare D1(2026-08-27 追加)は **`code` を持たない** — エラーは
 * `D1_ERROR: UNIQUE constraint failed: tenants.id: SQLITE_CONSTRAINT (extended:
 * SQLITE_CONSTRAINT_PRIMARYKEY)` のようにメッセージ本文だけで返る。そのため cause を
 * 辿る過程で `code` に加えてメッセージ本文も見る。文言は SQLite 本体のものなので、
 * SQLite/libSQL 側の将来のメッセージ変更にも同じ判定が効く。
 *
 * 用途: punch_events.supersedes_id の UNIQUE インデックス違反(同一イベントの二重無効化)を、
 * 修正申請の承認処理(apps/api/src/routes/corrections.ts)が 409 として扱うために使う。
 */
export function isUniqueConstraintError(err: unknown): boolean {
  let current: unknown = err;
  for (let depth = 0; depth < 5 && current !== undefined && current !== null; depth++) {
    if (current instanceof Error) {
      const code = (current as { code?: unknown }).code;
      if (typeof code === "string" && isUniqueViolationCode(code)) return true;
      // D1: code が無くメッセージ本文だけで返る(冒頭コメント参照)
      if (typeof current.message === "string" && UNIQUE_VIOLATION_MESSAGE.test(current.message)) return true;
    }
    current = current instanceof Error ? current.cause : undefined;
  }
  return false;
}

/** SQLite(D1 含む)が返す UNIQUE / PRIMARY KEY 違反の文言。 */
const UNIQUE_VIOLATION_MESSAGE = /UNIQUE constraint failed|SQLITE_CONSTRAINT_(UNIQUE|PRIMARYKEY)/;

/** SQLite の "SQLITE_CONSTRAINT*" と PostgreSQL の "23505"(unique_violation)。 */
function isUniqueViolationCode(code: string): boolean {
  return code.startsWith("SQLITE_CONSTRAINT") || code === "23505";
}
