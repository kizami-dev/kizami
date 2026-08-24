/**
 * 両ダイアレクトで正しい SQL になるテーブル別名(self join / 相関サブクエリ用)。
 *
 * なぜ drizzle-orm/sqlite-core の `alias` をそのまま使えないか(判断点 2026-08-24):
 *
 * KIZAMI のクエリ層は SQLite / PostgreSQL の両方で **sqlite-core のテーブルオブジェクト**を
 * 使って SQL を組み立てる(docs/design/db-dialects.md)。drizzle の PgDialect は JOIN 句だけ
 * `is(table, PgTable)` で分岐しており、SQLiteTable の別名はここで「else 節」に落ちて
 * `left join "superseding"`(元テーブル名が消えた SQL)を吐く。
 * FROM 句(`buildFromTable`)と相関サブクエリは両ダイアレクト同一実装なので問題ない。
 *
 * 対処: 別名オブジェクトの `getPrototypeOf` だけを差し替え、drizzle の `is()` から見て
 * 「PgTable でも SQLiteTable でも Table でもある」ように見せる。`is()` は
 * `Object.getPrototypeOf(value).constructor` を辿って静的プロパティ `entityKind` を比較する
 * 実装(drizzle-orm/entity.js)なので、その鎖だけを偽装すればよい。
 *
 * - プロパティ参照(列・シンボル)は Proxy の get が実テーブルへ委譲するので影響しない
 *   (`getPrototypeOf` トラップはメソッド解決には使われない)
 * - SQLite 側は `is(table, SQLiteTable)` が先に真になり、従来と同じ分岐を通る
 * - PostgreSQL 側は `is(table, PgTable)` が真になり、`左 join "punch_events" "superseding"` を吐く
 *
 * 生成 SQL の一致は test/dialect-portability.test.ts が両ダイアレクトで突き合わせている。
 * drizzle 側が JOIN の別名をダイアレクト非依存に扱うようになったら、この偽装は不要になる。
 */

import { entityKind } from "drizzle-orm";
import { alias as sqliteAlias, type SQLiteTable } from "drizzle-orm/sqlite-core";

/**
 * drizzle の `is()` が辿るコンストラクタ鎖の偽物。
 * PgTable -> SQLiteTable -> Table の順に `entityKind` を持たせる。
 */
const tableCtor: Record<symbol, string> = { [entityKind]: "Table" };
const sqliteTableCtor: Record<symbol, string> = Object.assign(Object.create(tableCtor) as object, {
  [entityKind]: "SQLiteTable",
});
const dualTableCtor: Record<symbol, string> = Object.assign(Object.create(sqliteTableCtor) as object, {
  [entityKind]: "PgTable",
});
const dualTablePrototype = { constructor: dualTableCtor };

/**
 * テーブルに別名を付ける。`drizzle-orm/sqlite-core` の `alias` の置き換え。
 *
 * @param table 別名を付ける sqlite-core テーブル
 * @param aliasName SQL 上の別名
 */
export function alias<T extends SQLiteTable>(table: T, aliasName: string): T {
  const aliased = sqliteAlias(table, aliasName) as object;
  return new Proxy(aliased, {
    getPrototypeOf: () => dualTablePrototype,
  }) as T;
}
