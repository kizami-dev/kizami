/**
 * クエリ層を「両ダイアレクト共通の1本」で持つ前提が崩れていないことの検査。
 *
 * KIZAMI のクエリ層(src/queries/)は SQLite でも PostgreSQL でも sqlite-core の
 * テーブルオブジェクトで SQL を組み立てる(docs/design/db-dialects.md)。この前提は
 * drizzle の内部実装(PgDialect が SQLiteTable をどう扱うか)に依存しているため、
 * 実 DB を使わずに **生成される SQL 文字列そのもの**を突き合わせて守る。
 *
 * 特に JOIN の別名は素の `drizzle-orm/sqlite-core` の `alias` だと PostgreSQL 側で
 * 元テーブル名が消える(`left join "superseding"`)。src/alias.ts がこれを吸収している
 * ことを、ここで両ダイアレクトの SQL を比較して確認する。
 *
 * 3つめのダイアレクト Cloudflare D1(2026-08-27 追加)も同じ観点で並べてある。D1 は
 * drizzle の中で libSQL と同じ `SQLiteAsyncDialect` を使うので SQL は一致するはずだが、
 * 「一致するはず」を実際に突き合わせておく(D1 の実 DB に対する検査は D1 レグ
 * = packages/db/vitest.d1.config.ts 側が持つ。このファイル自体は pg / @libsql/client の
 * ドライバを直接読むため Node レグ専用)。
 */

import { describe, expect, it } from "vitest";
import { and, eq, notExists, sql } from "drizzle-orm";
import { drizzle as drizzleLibsql } from "drizzle-orm/libsql";
import { drizzle as drizzleD1 } from "drizzle-orm/d1";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { alias as sqliteCoreAlias } from "drizzle-orm/sqlite-core";
import { Pool } from "pg";
import { alias } from "../src/alias.js";
import { resolveDialect } from "../src/dialect.js";
import { punchEvents } from "../src/schema/index.js";

// `.toSQL()` は接続を張らないので、ダミーのクライアント/プールで十分
// (Pool のコンストラクタは接続しない)
const sqliteDb = drizzleLibsql({ connection: { url: ":memory:" } }) as never as ReturnType<typeof drizzleLibsql>;
const pgDb = drizzlePg(new Pool({ connectionString: "postgres://localhost/unused" })) as never as {
  select: (typeof sqliteDb)["select"];
};
// D1 も同様。バインディングは触られないのでダミーで足りる
const d1Db = drizzleD1({} as never) as never as {
  select: (typeof sqliteDb)["select"];
  insert: (typeof sqliteDb)["insert"];
};

/** 「有効な打刻」= 他イベントに supersede されていないもの、を引くクエリ(punches.ts と同型)。 */
function buildValidPunchQuery(db: { select: (typeof sqliteDb)["select"] }, superseding: typeof punchEvents) {
  return db
    .select()
    .from(punchEvents)
    .leftJoin(superseding, eq(superseding.supersedesId, punchEvents.id))
    .where(
      and(
        eq(punchEvents.tenantId, "t1"),
        notExists(db.select({ one: sql`1` }).from(superseding).where(eq(superseding.supersedesId, punchEvents.id))),
      ),
    );
}

describe("resolveDialect", () => {
  it.each([
    [undefined, "sqlite"],
    [":memory:", "sqlite"],
    ["file:./kizami.db", "sqlite"],
    ["libsql://kizami.turso.io", "sqlite"],
    ["postgres://user:pass@localhost:5432/kizami", "postgres"],
    ["postgresql://user:pass@localhost:5432/kizami", "postgres"],
    ["POSTGRES://user@localhost/kizami", "postgres"],
    ["  postgres://user@localhost/kizami  ", "postgres"],
  ])("%s -> %s", (url, expected) => {
    expect(resolveDialect(url)).toBe(expected);
  });
});

describe("クエリ層の SQL が両ダイアレクトで一致する", () => {
  it("self join + 相関サブクエリ: src/alias.ts の別名は両ダイアレクトで元テーブル名を保つ", () => {
    const sqliteSql = buildValidPunchQuery(sqliteDb, alias(punchEvents, "superseding")).toSQL().sql;
    const pgSql = buildValidPunchQuery(pgDb, alias(punchEvents, "superseding")).toSQL().sql;

    // 別名の定義が JOIN 句に出ていること(ここが素の sqlite-core alias では PostgreSQL で壊れる)
    expect(sqliteSql).toContain('left join "punch_events" "superseding"');
    expect(pgSql).toContain('left join "punch_events" "superseding"');

    // プレースホルダの記法(? と $1)以外は同一 SQL であること
    expect(pgSql.replace(/\$\d+/g, "?")).toBe(sqliteSql);

    // D1 は libSQL と同じ SQLiteAsyncDialect なので、そのまま一致する
    expect(buildValidPunchQuery(d1Db, alias(punchEvents, "superseding")).toSQL().sql).toBe(sqliteSql);
  });

  it("回帰確認: 素の sqlite-core の alias だと PostgreSQL 側で元テーブル名が落ちる", () => {
    // src/alias.ts が要る理由そのもの。drizzle 側でこれが直ったらこのテストが落ちるので、
    // そのときは src/alias.ts を撤去してよい合図になる
    const pgSql = buildValidPunchQuery(pgDb, sqliteCoreAlias(punchEvents, "superseding") as unknown as typeof punchEvents).toSQL().sql;
    expect(pgSql).toContain('left join "superseding"');
    expect(pgSql).not.toContain('left join "punch_events" "superseding"');
  });

  it("insert ... on conflict do update / returning の SQL が構造的に一致する", () => {
    const values = { id: "p1", tenantId: "t1", userId: "u1", kind: "clock_in", occurredAt: 1, recordedAt: 1, source: "web", actorId: "u1" };
    const build = (db: typeof sqliteDb): string =>
      db.insert(punchEvents).values(values).onConflictDoUpdate({ target: punchEvents.id, set: { note: "x" } }).returning().toSQL().sql;

    // ダイアレクトの表記差(いずれも意味は同じ)は吸収してから比較する:
    // - プレースホルダ: `?` と `$1`
    // - 値を省略した列: SQLite は `null`、PostgreSQL は `default`
    //   (該当列はいずれも DEFAULT を持たないので結果は NULL で一致する)
    // - ON CONFLICT のターゲット: SQLite は `"t"."id"` と修飾、PostgreSQL は `"id"`
    const normalize = (sqlText: string): string =>
      sqlText
        .replace(/\$\d+/g, "?")
        .replaceAll("default", "null")
        .replaceAll('on conflict ("punch_events"."id")', 'on conflict ("id")');

    expect(normalize(build(pgDb as never))).toBe(normalize(build(sqliteDb)));
    expect(build(d1Db as never)).toBe(build(sqliteDb));
  });
});
