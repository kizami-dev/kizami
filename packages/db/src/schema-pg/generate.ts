/**
 * sqlite-core のスキーマ定義から pg-core のミラー(DDL 専用)を組み立てる。
 *
 * 背景 / 判断点(2026-08-24, PostgreSQL ダイアレクト対応):
 * - KIZAMI のスキーマの単一の正(single source of truth)は `src/schema/`(sqlite-core)である。
 *   PostgreSQL 用に同じ定義を手で二重管理すると必ずズレるため、pg-core 側は
 *   **sqlite-core のテーブルオブジェクトを読んで実行時に生成する**。
 * - ここで作る pg テーブルは **drizzle-kit に DDL(migrations-pg/)を生成させるためだけ**に
 *   存在する。クエリ層(src/queries/)は両ダイアレクトとも sqlite-core のテーブルオブジェクトを
 *   使い続ける(理由は docs/design/db-dialects.md「クエリ層は単一」参照)。
 * - 型のマッピングは「SQLite に寄せる」= 移行時に値の解釈が変わらないことを最優先する:
 *     text            -> text
 *     integer         -> integer      (時刻は UTC エポック"分"。int4 上限は西暦 6000 年台)
 *     integer(boolean)-> integer      (pg の boolean にはしない。0/1 のまま両ダイアレクト共通)
 *     real            -> double precision (SQLite の REAL は 8 バイト浮動小数。pg の real は
 *                                          4 バイトなので GPS 座標が丸まる)
 * - boolean モードの default は `true/false` で保持されているので、integer 列に載せるため
 *   1/0 に変換する。
 * - 部分 UNIQUE index の WHERE 述語は、SQLite 版が `"table"."col" = ...` と修飾付きで
 *   出力されている(SQLite は許容する)。PostgreSQL は index 述語での修飾付き参照を拒否するため、
 *   SQL チャンクを歩いて Column 参照を非修飾の識別子へ置き換える。
 */

import { is, SQL, sql, type Column } from "drizzle-orm";
import { Column as ColumnClass } from "drizzle-orm/column";
import {
  doublePrecision,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
  type AnyPgColumn,
  type PgColumnBuilderBase,
  type PgTable,
} from "drizzle-orm/pg-core";
import { getTableConfig, SQLiteTable } from "drizzle-orm/sqlite-core";

/** 生成済み pg テーブル(テーブル名 -> pgTable)。FK の遅延解決に使う。 */
type Registry = Map<string, PgTable>;

/** SQL 述語中の Column 参照を「非修飾の識別子」へ置き換える(部分 index の WHERE 用)。 */
function unqualifyColumns(input: SQL): SQL {
  const chunks = (input as unknown as { queryChunks: unknown[] }).queryChunks.map((chunk) => {
    if (is(chunk, ColumnClass)) return sql.identifier((chunk as Column).name);
    if (is(chunk, SQL)) return unqualifyColumns(chunk as SQL);
    return chunk;
  });
  return sql.join(chunks as never[]);
}

type FkTarget = { table: string; column: string };

function buildColumn(
  col: ReturnType<typeof getTableConfig>["columns"][number],
  fk: FkTarget | undefined,
  registry: Registry,
): PgColumnBuilderBase {
  let builder: ReturnType<typeof text> | ReturnType<typeof integer> | ReturnType<typeof doublePrecision>;
  switch (col.columnType) {
    case "SQLiteText":
      builder = text(col.name);
      break;
    case "SQLiteInteger":
    case "SQLiteBoolean":
      builder = integer(col.name);
      break;
    case "SQLiteReal":
      builder = doublePrecision(col.name);
      break;
    default:
      throw new Error(`schema-pg: 未対応のカラム型です: ${col.columnType} (${col.name})`);
  }

  let b = builder as unknown as {
    notNull: () => typeof b;
    primaryKey: () => typeof b;
    default: (v: unknown) => typeof b;
    references: (fn: () => AnyPgColumn) => typeof b;
  };
  if (col.notNull) b = b.notNull();
  if (col.primary) b = b.primaryKey();
  if (col.hasDefault && col.default !== undefined) {
    // boolean モードの列は pg 側でも integer なので 0/1 へ寄せる
    const value = col.columnType === "SQLiteBoolean" ? (col.default === true ? 1 : 0) : col.default;
    b = b.default(value);
  }
  if (fk !== undefined) {
    // 参照先は同じ generate 実行内で必ず registry に載る。thunk なので自己参照
    // (punch_events.supersedes_id -> punch_events.id)や前方参照も解決できる
    b = b.references(() => {
      const target = registry.get(fk.table);
      if (target === undefined) throw new Error(`schema-pg: FK の参照先テーブルが見つかりません: ${fk.table}`);
      return (target as unknown as Record<string, AnyPgColumn>)[fk.column] as AnyPgColumn;
    });
  }
  return b as unknown as PgColumnBuilderBase;
}

/**
 * sqlite-core のスキーマ export 群から pg-core のテーブル群を生成する。
 *
 * @param sqliteSchema `src/schema/index.ts` の名前空間 export
 * @returns export 名 -> pgTable。テーブル名・列名・NOT NULL・default・PK・index・FK が sqlite 側と一致する
 */
export function buildPgSchema(sqliteSchema: Record<string, unknown>): Record<string, PgTable> {
  const registry: Registry = new Map();
  const byExportName: Record<string, PgTable> = {};

  const entries = Object.entries(sqliteSchema).filter(([, value]) => is(value, SQLiteTable)) as [string, SQLiteTable][];

  for (const [exportName, sqliteTbl] of entries) {
    const config = getTableConfig(sqliteTbl);

    // 列単位の FK(`.references(() => other.id)`)を列名で引けるようにする
    const fkByColumn = new Map<string, FkTarget>();
    for (const foreignKey of config.foreignKeys) {
      const ref = foreignKey.reference();
      if (ref.columns.length !== 1 || ref.foreignColumns.length !== 1) {
        throw new Error(`schema-pg: 複合 FK は未対応です (${config.name})`);
      }
      fkByColumn.set(ref.columns[0]!.name, {
        table: getTableConfig(ref.foreignTable as SQLiteTable).name,
        column: ref.foreignColumns[0]!.name,
      });
    }

    const columns: Record<string, PgColumnBuilderBase> = {};
    for (const col of config.columns) {
      // pg 側の TS プロパティ名は列名(snake_case)。クエリ層は pg テーブルを参照しないため、
      // sqlite 側の camelCase プロパティ名に合わせる必要はない
      columns[col.name] = buildColumn(col, fkByColumn.get(col.name), registry);
    }

    const pgTbl = pgTable(config.name, columns, (table) => {
      const extras: unknown[] = [];
      for (const idx of config.indexes) {
        const idxConfig = (idx as unknown as { config: { name: string; unique: boolean; columns: Column[]; where?: SQL } }).config;
        const cols = idxConfig.columns.map((c) => (table as Record<string, unknown>)[c.name] as AnyPgColumn);
        const builder = idxConfig.unique ? uniqueIndex(idxConfig.name) : index(idxConfig.name);
        const built = builder.on(...(cols as [AnyPgColumn, ...AnyPgColumn[]]));
        extras.push(idxConfig.where ? built.where(unqualifyColumns(idxConfig.where)) : built);
      }
      for (const pk of config.primaryKeys) {
        const pkColumns = (pk as unknown as { columns: Column[] }).columns.map(
          (c) => (table as Record<string, unknown>)[c.name] as AnyPgColumn,
        );
        extras.push(primaryKey({ columns: pkColumns as [AnyPgColumn, ...AnyPgColumn[]] }));
      }
      return extras as never[];
    });

    registry.set(config.name, pgTbl);
    byExportName[exportName] = pgTbl;
  }

  return byExportName;
}
