/**
 * sqlite-core(src/schema/, 単一の正)と pg-core ミラー(src/schema-pg/)のズレ検出。
 *
 * pg 側は `buildPgSchema` が sqlite 側から実行時生成するので原理的にはズレないが、
 * 生成器そのもののバグ(型の取りこぼし・index/FK の欠落・default 変換ミス)は
 * このテストでしか捕まらない。help-content の locale 差分テストと同じ役割。
 *
 * 意図的に**一致させない**のは SQL 型名だけで、その対応表は下の EXPECTED_SQL_TYPE にある
 * (integer(boolean) を pg の boolean にしない・real を double precision にする理由は
 *  src/schema-pg/generate.ts の冒頭コメント参照)。
 */

import { describe, expect, it } from "vitest";
import { is } from "drizzle-orm";
import { getTableConfig as getPgTableConfig, type PgTable } from "drizzle-orm/pg-core";
import { getTableConfig as getSqliteTableConfig, SQLiteTable } from "drizzle-orm/sqlite-core";
import * as sqliteSchema from "../src/schema/index.js";
import { pgTables } from "../src/schema-pg/index.js";

/** sqlite-core の columnType -> pg-core で期待する SQL 型。 */
const EXPECTED_SQL_TYPE: Record<string, string> = {
  SQLiteText: "text",
  SQLiteInteger: "integer",
  // boolean モードも pg では integer(0/1)。両ダイアレクトで値の見え方を揃えるため
  SQLiteBoolean: "integer",
  // SQLite の REAL は 8 バイト。pg の real(4 バイト)では GPS 座標が丸まる
  SQLiteReal: "double precision",
};

interface NormalizedTable {
  name: string;
  columns: { name: string; sqlType: string; notNull: boolean; primary: boolean; default: unknown }[];
  indexes: { name: string; unique: boolean; columns: string[]; partial: boolean }[];
  primaryKeys: string[][];
  foreignKeys: { columns: string[]; foreignTable: string; foreignColumns: string[] }[];
}

function sortByName<T extends { name: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.name.localeCompare(b.name));
}

function normalizeSqlite(table: SQLiteTable): NormalizedTable {
  const config = getSqliteTableConfig(table);
  return {
    name: config.name,
    columns: sortByName(
      config.columns.map((col) => {
        const sqlType = EXPECTED_SQL_TYPE[col.columnType];
        if (sqlType === undefined) throw new Error(`未知の columnType: ${col.columnType}`);
        return {
          name: col.name,
          sqlType,
          notNull: col.notNull,
          primary: col.primary,
          // boolean モードの default は pg 側で 0/1 になる。期待値もそちらへ寄せる
          default: col.columnType === "SQLiteBoolean" && col.default !== undefined ? (col.default === true ? 1 : 0) : col.default,
        };
      }),
    ),
    indexes: sortByName(
      config.indexes.map((idx) => {
        const c = (idx as unknown as { config: { name: string; unique: boolean; columns: { name: string }[]; where?: unknown } }).config;
        return { name: c.name, unique: c.unique, columns: c.columns.map((x) => x.name), partial: c.where !== undefined };
      }),
    ),
    primaryKeys: config.primaryKeys.map((pk) => (pk as unknown as { columns: { name: string }[] }).columns.map((c) => c.name)).sort(),
    foreignKeys: config.foreignKeys
      .map((fk) => {
        const ref = fk.reference();
        return {
          columns: ref.columns.map((c) => c.name),
          foreignTable: getSqliteTableConfig(ref.foreignTable as SQLiteTable).name,
          foreignColumns: ref.foreignColumns.map((c) => c.name),
        };
      })
      .sort((a, b) => a.columns.join().localeCompare(b.columns.join())),
  };
}

function normalizePg(table: PgTable): NormalizedTable {
  const config = getPgTableConfig(table);
  return {
    name: config.name,
    columns: sortByName(
      config.columns.map((col) => ({
        name: col.name,
        sqlType: col.getSQLType(),
        notNull: col.notNull,
        primary: col.primary,
        default: col.default,
      })),
    ),
    indexes: sortByName(
      config.indexes.map((idx) => {
        const c = (idx as unknown as { config: { name: string; unique: boolean; columns: { name: string }[]; where?: unknown } }).config;
        return { name: c.name, unique: c.unique, columns: c.columns.map((x) => x.name), partial: c.where !== undefined };
      }),
    ),
    primaryKeys: config.primaryKeys.map((pk) => (pk as unknown as { columns: { name: string }[] }).columns.map((c) => c.name)).sort(),
    foreignKeys: config.foreignKeys
      .map((fk) => {
        const ref = fk.reference();
        return {
          columns: ref.columns.map((c) => c.name),
          foreignTable: getPgTableConfig(ref.foreignTable as PgTable).name,
          foreignColumns: ref.foreignColumns.map((c) => c.name),
        };
      })
      .sort((a, b) => a.columns.join().localeCompare(b.columns.join())),
  };
}

const sqliteTables = Object.fromEntries(
  Object.entries(sqliteSchema).filter(([, value]) => is(value, SQLiteTable)),
) as Record<string, SQLiteTable>;

describe("schema drift (sqlite-core <-> pg-core)", () => {
  it("両ダイアレクトの export 名が一致する", () => {
    expect(Object.keys(pgTables).sort()).toEqual(Object.keys(sqliteTables).sort());
  });

  it("src/schema-pg/index.ts が全テーブルを名前付き export している(drizzle-kit の走査対象)", async () => {
    const module_ = (await import("../src/schema-pg/index.js")) as Record<string, unknown>;
    for (const name of Object.keys(sqliteTables)) {
      expect(module_[name], `${name} が src/schema-pg/index.ts の export に無い`).toBeDefined();
    }
  });

  for (const [exportName, sqliteTable] of Object.entries(sqliteTables)) {
    it(`${exportName}: テーブル名・列・NOT NULL・default・index・PK・FK が一致する`, () => {
      const pgTable = pgTables[exportName];
      expect(pgTable, `pg 側に ${exportName} が無い`).toBeDefined();
      expect(normalizePg(pgTable!)).toEqual(normalizeSqlite(sqliteTable));
    });
  }
});
