/**
 * SQLite(libSQL)→ PostgreSQL の**データ移行ツール**(`pnpm --filter @kizami/db migrate-data`)。
 *
 * 位置づけ: 配備の1回きりの作業で使う Node 専用ツール。アプリの実行経路(apps/api)からは
 * 呼ばない。CLI 本体は src/migrate-data-cli.ts、手順は docs/design/db-dialects.md
 * 「SQLite → PostgreSQL のデータ移行」節。
 *
 * 成立する理由(なぜ行をそのままコピーできるのか):
 * PostgreSQL 側の DDL は「SQLite に寄せて」生成してある(docs/design/db-dialects.md §3。
 * boolean は integer の 0/1 のまま、JSON は text、日付は "YYYY-MM-DD" の text、時刻は
 * UTC エポック分の integer、REAL は double precision)。つまり**両ダイアレクトで値の表現が
 * 完全に一致する**ので、行は変換なしで移せる。読み書きは src/queries/ と同じく sqlite-core の
 * テーブルオブジェクトを通すため、drizzle の値マッピング(boolean ⇄ 0/1 等)も同一経路を通る。
 *
 * この実装が守っている手順(判断点 2026-08-27):
 *
 * 1. **移行先は空でなければならない**(`__drizzle_migrations` と KIZAMI のテーブルだけ、全テーブル 0 行)。
 *    マージ(既存データへの追記)は実装しない — KIZAMI の中核テーブルは追記専用で、
 *    「有効な行 = 他の行の supersedes_id に参照されていないもの」という形で状態を持つ。
 *    別々の DB の追記列を混ぜると supersedes の連鎖が両系統に分岐し、
 *    「有効な打刻」の判定そのものが壊れる(しかも UNIQUE 制約では検出できない)。
 *    移行先が空であれば、この整合はコピー元のものがそのまま保たれる。
 * 2. **移行先にマイグレーションを先に流す**(`migrateDb`)。DDL は必ず migrations-pg/ 由来にする
 * 3. **両者が同じスキーマ版であることを確認する**。マイグレーションの通し番号はダイアレクトで
 *    別系統(sqlite 0000〜0030 / pg 0000〜0005)なので番号は比較できない。代わりに
 *    (a) 各ダイアレクトの journal を全件適用済みであること、(b) 実 DB を introspect した
 *    テーブル集合・列集合が drizzle スキーマと**両側で一致**すること、の2点で判定する
 * 4. **FK 依存順にテーブル単位でコピー**する(順序は drizzle スキーマの FK グラフから導出)。
 *    500 行ずつの INSERT、テーブルごとに PostgreSQL 側のトランザクション
 * 5. **コピー後に検証**する。全テーブルの行数一致 + 中核テーブル(punch_events /
 *    leave_grants / closing_snapshots)のチェックサム(件数・整数列の合計・id の最小最大)
 * 6. **シーケンスは存在しない**(PK はアプリ生成の UUIDv7)。serial / identity 列が無いことを
 *    表明して、この前提が将来も崩れないようにする
 *
 * **コピー元には一切書き込まない**(SELECT のみ。マイグレーションも流さない)。libSQL の
 * クライアントに読み取り専用オープンの指定が無いため「書かない」ことはこの実装が守っている。
 * 移行中にアプリが動いていると取りこぼしが出るので、CLI は停止済みの明示(`--i-stopped-the-app`)を
 * 要求する。ロールバックは「コピー元の SQLite ファイルがそのまま残っている」こと自体で足りる。
 */

import { readFileSync } from "node:fs";
import { asc, eq, getTableColumns, gt, is, type Column } from "drizzle-orm";
import { getTableConfig, SQLiteTable } from "drizzle-orm/sqlite-core";
import { createDatabase, defaultMigrationsFolder, migrateDb } from "./migrate.js";
import * as schema from "./schema/index.js";
import type { DatabaseHandle, DbClient } from "./types.js";

/** 1回の INSERT にまとめる行数の既定値。 */
export const DEFAULT_BATCH_SIZE = 500;

/**
 * PostgreSQL のバインドパラメータ上限(65535)に対する安全側の上限。
 * 実効バッチ = min(batchSize, floor(この値 / 列数))。現在の最大列数は 23 なので
 * 既定の 500 行(11,500 パラメータ)は余裕で収まるが、列を増やしても壊れないようにしておく。
 */
const MAX_BIND_PARAMS = 60000;

/** チェックサムを取る中核テーブルと、合計を取る整数列。 */
const CHECKSUM_TARGETS: readonly { table: string; column: string }[] = [
  { table: "punch_events", column: "occurred_at" },
  { table: "leave_grants", column: "days" },
  { table: "closing_snapshots", column: "minutes" },
];

/** 移行の進捗・検証結果の出力先(既定は console.log)。 */
export type MigrateDataLogger = (line: string) => void;

/** テーブル1つ分のコピー結果。 */
export interface TableCopyResult {
  /** テーブル名(snake_case) */
  table: string;
  /** コピー元の行数 */
  sourceRows: number;
  /** コピー後に移行先で数えた行数 */
  targetRows: number;
}

/** 中核テーブルのチェックサム(件数・整数列の合計・id の最小/最大)。 */
export interface TableChecksum {
  /** 行数 */
  count: number;
  /** 整数列の合計(0 行なら null) */
  sum: number | null;
  /** id の最小値(0 行なら null) */
  minId: string | null;
  /** id の最大値(0 行なら null) */
  maxId: string | null;
}

/** チェックサムの突き合わせ結果。 */
export interface ChecksumComparison {
  /** テーブル名 */
  table: string;
  /** 合計を取った整数列 */
  column: string;
  /** コピー元の値 */
  source: TableChecksum;
  /** 移行先の値 */
  target: TableChecksum;
  /** 4つの値がすべて一致したか */
  matched: boolean;
}

/** 移行結果のレポート。`formatMigrationReport()` で人が読む形にできる。 */
export interface MigrationReport {
  /** FK 依存順のテーブル別行数 */
  tables: TableCopyResult[];
  /** 中核テーブルのチェックサム突き合わせ */
  checksums: ChecksumComparison[];
  /** コピーした総行数 */
  totalRows: number;
  /** コピー開始から検証完了までのミリ秒 */
  durationMs: number;
}

/** `copyDatabase()` のオプション。 */
export interface CopyDatabaseOptions {
  /** 1回の INSERT にまとめる行数(既定 500) */
  batchSize?: number;
  /** 進捗の出力先(既定 console.log) */
  log?: MigrateDataLogger;
}

/** drizzle スキーマから導出したテーブル1つ分の情報(コピー計画)。 */
export interface TablePlan {
  /** テーブル名(snake_case) */
  name: string;
  /** sqlite-core のテーブルオブジェクト(読み書き両方でこれを使う) */
  table: SQLiteTable;
  /** 列名(snake_case)の集合 */
  columnNames: Set<string>;
  /** 列数(バインドパラメータ上限の計算に使う) */
  columnCount: number;
  /** PK の TS プロパティ名。単一列 PK ならキーセットページングに使える */
  pkKeys: string[];
  /** 自己参照 FK の TS プロパティ名(punch_events.supersedes_id 等) */
  selfRefKeys: string[];
  /** TS プロパティ名 -> Column */
  columnsByKey: Record<string, Column>;
}

/** テーブル名 -> 列名集合。 */
type TableColumnMap = Map<string, Set<string>>;

/**
 * drizzle スキーマ(sqlite-core)から FK 依存順のコピー計画を作る。
 *
 * 参照先が先に来る順(Kahn 法)。自己参照 FK はテーブル間の順序には効かないので辺から除き、
 * コピー時に「一旦 null で入れて後から UPDATE」で解決する(`copyTable` 参照)。
 * 相互参照(循環)は現在のスキーマには無く、増えたらここで検出して落とす。
 */
export function buildTablePlans(): TablePlan[] {
  const plans = new Map<string, TablePlan>();
  const dependencies = new Map<string, Set<string>>();

  for (const value of Object.values(schema)) {
    if (!is(value, SQLiteTable)) continue;
    const table = value;
    const config = getTableConfig(table);
    const columnsByKey = getTableColumns(table) as unknown as Record<string, Column>;

    const keyByColumnName = new Map<string, string>();
    for (const [key, column] of Object.entries(columnsByKey)) keyByColumnName.set(column.name, key);

    const selfRefKeys: string[] = [];
    const deps = new Set<string>();
    for (const foreignKey of config.foreignKeys) {
      const reference = foreignKey.reference();
      const target = getTableConfig(reference.foreignTable as SQLiteTable).name;
      if (target === config.name) {
        for (const column of reference.columns) {
          const key = keyByColumnName.get(column.name);
          if (key !== undefined) selfRefKeys.push(key);
        }
        continue;
      }
      deps.add(target);
    }

    // PK は「列に付いた .primaryKey()」か「複合 PK 宣言」のどちらか
    const pkColumnNames =
      config.primaryKeys.length > 0
        ? (config.primaryKeys[0] as unknown as { columns: Column[] }).columns.map((c) => c.name)
        : config.columns.filter((c) => c.primary).map((c) => c.name);
    const pkKeys = pkColumnNames.map((name) => keyByColumnName.get(name)).filter((key): key is string => key !== undefined);
    if (pkKeys.length === 0) {
      // PK が無いとページングの順序が決まらず、取りこぼし/二重コピーが黙って起きる
      throw new Error(`migrate-data: PK の無いテーブルは未対応です(読み出し順が決まらない): ${config.name}`);
    }

    plans.set(config.name, {
      name: config.name,
      table,
      columnNames: new Set(config.columns.map((c) => c.name)),
      columnCount: config.columns.length,
      pkKeys,
      selfRefKeys,
      columnsByKey,
    });
    dependencies.set(config.name, deps);
  }

  // Kahn 法。候補は名前順に取り出して、実行ごとに同じ順序になるようにする
  const ordered: TablePlan[] = [];
  const remaining = new Set(plans.keys());
  while (remaining.size > 0) {
    const ready = [...remaining].filter((name) => [...(dependencies.get(name) ?? [])].every((dep) => !remaining.has(dep))).sort();
    if (ready.length === 0) {
      throw new Error(`migrate-data: FK に循環があります(コピー順を決められません): ${[...remaining].sort().join(", ")}`);
    }
    for (const name of ready) {
      const plan = plans.get(name);
      if (plan !== undefined) ordered.push(plan);
      remaining.delete(name);
    }
  }
  return ordered;
}

/** journal(migrations/meta/_journal.json)のエントリ数 = そのダイアレクトの総マイグレーション数。 */
function journalEntryCount(dialect: "sqlite" | "postgres"): number {
  const path = `${defaultMigrationsFolder(dialect)}/meta/_journal.json`;
  const journal = JSON.parse(readFileSync(path, "utf8")) as { entries?: unknown[] };
  return journal.entries?.length ?? 0;
}

/** SQLite 側の「テーブル -> 列名集合」(内部テーブルと適用履歴は除く)。 */
async function introspectSqlite(client: DbClient): Promise<TableColumnMap> {
  const { rows } = await client.execute(
    "SELECT m.name AS table_name, p.name AS column_name FROM sqlite_master m " +
      "JOIN pragma_table_info(m.name) p WHERE m.type = 'table' AND m.name NOT LIKE 'sqlite_%' AND m.name != '__drizzle_migrations'",
  );
  return groupColumns(rows);
}

/** PostgreSQL 側の「テーブル -> 列名集合」(search_path 先頭のスキーマ、適用履歴は除く)。 */
async function introspectPostgres(client: DbClient): Promise<TableColumnMap> {
  const { rows } = await client.execute(
    "SELECT table_name, column_name FROM information_schema.columns " +
      "WHERE table_schema = current_schema() AND table_name != '__drizzle_migrations'",
  );
  return groupColumns(rows);
}

function groupColumns(rows: Record<string, unknown>[]): TableColumnMap {
  const map: TableColumnMap = new Map();
  for (const row of rows) {
    const table = String(row.table_name);
    const column = String(row.column_name);
    const set = map.get(table) ?? new Set<string>();
    set.add(column);
    map.set(table, set);
  }
  return map;
}

/** introspect 結果を drizzle スキーマと突き合わせる。差分があれば全部並べて投げる。 */
function assertSchemaMatches(side: string, actual: TableColumnMap, plans: TablePlan[]): void {
  const problems: string[] = [];
  const expected = new Set(plans.map((p) => p.name));

  const extra = [...actual.keys()].filter((name) => !expected.has(name)).sort();
  if (extra.length > 0) {
    problems.push(`${side}: unknown table(s) not in the KIZAMI schema: ${extra.join(", ")}`);
  }
  for (const plan of plans) {
    const columns = actual.get(plan.name);
    if (columns === undefined) {
      problems.push(`${side}: missing table: ${plan.name}`);
      continue;
    }
    const missing = [...plan.columnNames].filter((c) => !columns.has(c)).sort();
    const surplus = [...columns].filter((c) => !plan.columnNames.has(c)).sort();
    if (missing.length > 0) problems.push(`${side}: ${plan.name}: missing column(s): ${missing.join(", ")}`);
    if (surplus.length > 0) problems.push(`${side}: ${plan.name}: unexpected column(s): ${surplus.join(", ")}`);
  }
  if (problems.length > 0) {
    throw new Error(
      `migrate-data: schema mismatch — source and target must be at the same schema version.\n` +
        problems.map((p) => `  - ${p}`).join("\n") +
        `\nUpgrade the KIZAMI instance (so all migrations are applied) and retry.`,
    );
  }
}

/** 適用済みマイグレーション件数(SQLite)。履歴テーブルが無ければ「未マイグレーション」として投げる。 */
async function countAppliedSqlite(client: DbClient): Promise<number> {
  const { rows } = await client.execute(
    "SELECT count(*) AS n FROM sqlite_master WHERE type = 'table' AND name = '__drizzle_migrations'",
  );
  if (Number(rows[0]?.n ?? 0) === 0) {
    throw new Error(
      "migrate-data: the source database has no __drizzle_migrations table — it is not a migrated KIZAMI database " +
        "(check --from; a wrong path makes libSQL create an empty file).",
    );
  }
  const applied = await client.execute("SELECT count(*) AS n FROM __drizzle_migrations");
  return Number(applied.rows[0]?.n ?? 0);
}

/**
 * 適用済みマイグレーション件数(PostgreSQL)。
 * drizzle の履歴テーブルは既定で `drizzle` スキーマに置かれるが、`pgSchema` を指定した場合は
 * そのスキーマに入る(migrateDb の migrationsSchema)。両方を見る。
 */
async function countAppliedPostgres(client: DbClient): Promise<number> {
  const { rows } = await client.execute(
    "SELECT to_regclass('__drizzle_migrations') AS in_search_path, to_regclass('drizzle.__drizzle_migrations') AS in_drizzle",
  );
  const relation = rows[0]?.in_search_path != null ? '"__drizzle_migrations"' : rows[0]?.in_drizzle != null ? 'drizzle."__drizzle_migrations"' : undefined;
  if (relation === undefined) {
    throw new Error("migrate-data: the target database has no __drizzle_migrations table — apply the PostgreSQL migrations first.");
  }
  const applied = await client.execute(`SELECT count(*) AS n FROM ${relation}`);
  return Number(applied.rows[0]?.n ?? 0);
}

/**
 * コピー元・コピー先が同じスキーマ版であることを確認する。
 *
 * 通し番号(sqlite 00xx / pg 000x)は系統が別で比較できないため、
 * 「各ダイアレクトの journal を全件適用済み」+「introspect した表・列が drizzle スキーマと一致」で見る。
 */
async function verifySchemaVersions(source: DatabaseHandle, target: DatabaseHandle, plans: TablePlan[]): Promise<void> {
  const sourceApplied = await countAppliedSqlite(source.client);
  const sourceExpected = journalEntryCount("sqlite");
  if (sourceApplied !== sourceExpected) {
    throw new Error(
      `migrate-data: the source database is at migration ${sourceApplied}/${sourceExpected}. ` +
        "Start the current KIZAMI version once against the SQLite database (migrations run at startup), stop it again, then retry.",
    );
  }
  const targetApplied = await countAppliedPostgres(target.client);
  const targetExpected = journalEntryCount("postgres");
  if (targetApplied !== targetExpected) {
    throw new Error(`migrate-data: the target database is at migration ${targetApplied}/${targetExpected} (expected all of migrations-pg/).`);
  }

  assertSchemaMatches("source", await introspectSqlite(source.client), plans);
  assertSchemaMatches("target", await introspectPostgres(target.client), plans);
}

/**
 * 移行先が空であることを確認する(全テーブル 0 行)。
 *
 * マージ(既存データへの追記)を実装しない理由はファイル冒頭のコメント参照 —
 * 追記専用テーブルのマージは supersedes の整合を壊す。
 */
async function assertTargetEmpty(target: DatabaseHandle, plans: TablePlan[]): Promise<void> {
  const populated: string[] = [];
  for (const plan of plans) {
    const count = await countRows(target.client, plan.name);
    if (count > 0) populated.push(`${plan.name} (${count})`);
  }
  if (populated.length > 0) {
    throw new Error(
      "migrate-data: the target database is not empty: " +
        populated.join(", ") +
        "\nThis tool only writes into an empty target — it has no merge semantics on purpose: " +
        "KIZAMI's core tables are append-only and derive their state from supersedes chains, " +
        "so mixing rows from two databases would silently break which punch/correction counts as current. " +
        "Drop and recreate the target database (or use a fresh schema) and retry.",
    );
  }
}

/**
 * serial / identity 列が無いことを表明する。
 *
 * KIZAMI の PK はアプリ生成の UUIDv7 なので、移行後に「シーケンスの現在値を進める」作業が要らない。
 * 将来 serial 列が入るとこの前提が黙って崩れるため、ここで気付けるようにしておく。
 */
async function assertNoSequences(target: DatabaseHandle): Promise<void> {
  const { rows } = await target.client.execute(
    "SELECT table_name, column_name FROM information_schema.columns " +
      "WHERE table_schema = current_schema() AND table_name != '__drizzle_migrations' " +
      "AND (is_identity = 'YES' OR column_default LIKE 'nextval%')",
  );
  if (rows.length > 0) {
    const columns = rows.map((row) => `${String(row.table_name)}.${String(row.column_name)}`).join(", ");
    throw new Error(
      `migrate-data: the target has serial/identity column(s): ${columns}. ` +
        "KIZAMI generates all primary keys in the application (UUIDv7), so this tool does not reset sequences. " +
        "Teach migrate-data to fix up sequences before allowing such a column.",
    );
  }
}

/** 1テーブルの行数を数える。 */
async function countRows(client: DbClient, table: string): Promise<number> {
  const { rows } = await client.execute(`SELECT count(*) AS n FROM "${table}"`);
  return Number(rows[0]?.n ?? 0);
}

/** チェックサム(件数・整数列の合計・id の最小/最大)を取る。両ダイアレクトで同じ SQL が通る。 */
async function checksum(client: DbClient, table: string, column: string): Promise<TableChecksum> {
  const { rows } = await client.execute(
    `SELECT count(*) AS n, sum("${column}") AS s, min("id") AS mn, max("id") AS mx FROM "${table}"`,
  );
  const row = rows[0] ?? {};
  return {
    count: Number(row.n ?? 0),
    // pg は count/sum を文字列で返す(bigint/numeric)ので数値へ寄せる
    sum: row.s == null ? null : Number(row.s),
    minId: row.mn == null ? null : String(row.mn),
    maxId: row.mx == null ? null : String(row.mx),
  };
}

/**
 * 1テーブルをコピーする。移行先のトランザクション1つで完結する(途中で落ちたらそのテーブルは丸ごと無効)。
 *
 * - コピー元は PK 順に読む。単一列 PK ならキーセット(`id > 直前の値`)、
 *   複合 PK のテーブル(help_overrides / slack_user_links / user_notification_settings)は
 *   件数が限られるので OFFSET で読む
 * - **自己参照 FK の列は一旦 null で INSERT し、同じトランザクションの最後に UPDATE で埋める**。
 *   行の並びに依存せず FK を満たせる(punch_events.supersedes_id は「あとから作られた行が
 *   古い行を指す」ので id 順で足りるはずだが、UUIDv7 の単調性に整合性を賭けたくない)。
 *   supersedes_id の UNIQUE index は null が複数あっても衝突しないので、途中の状態でも壊れない
 * - 空のテーブルでは**トランザクションを開かない**(1件目を読んでから開く)。KIZAMI は 43 テーブル
 *   あり、多くの配備では大半が空なので、往復を半分近く減らせる
 */
async function copyTable(source: DatabaseHandle, target: DatabaseHandle, plan: TablePlan, batchSize: number): Promise<number> {
  const effectiveBatch = Math.max(1, Math.min(batchSize, Math.floor(MAX_BIND_PARAMS / plan.columnCount)));
  const singlePk = plan.pkKeys.length === 1 ? plan.columnsByKey[plan.pkKeys[0] as string] : undefined;
  const orderColumns = plan.pkKeys.map((key) => plan.columnsByKey[key]).filter((c): c is Column => c !== undefined);
  const sourceDb = source.db;

  /** コピー元を PK 順に1バッチ読む(単一列 PK ならキーセット、複合 PK なら OFFSET)。 */
  async function readBatch(cursor: unknown, offset: number): Promise<Record<string, unknown>[]> {
    let query = sourceDb.select().from(plan.table).$dynamic();
    if (singlePk !== undefined && cursor !== undefined) query = query.where(gt(singlePk, cursor));
    if (orderColumns.length > 0) query = query.orderBy(...orderColumns.map((c) => asc(c)));
    query = query.limit(effectiveBatch);
    if (singlePk === undefined) query = query.offset(offset);
    return (await query) as unknown as Record<string, unknown>[];
  }

  const firstBatch = await readBatch(undefined, 0);
  if (firstBatch.length === 0) return 0;

  let copied = 0;
  await target.db.transaction(async (tx) => {
    /** 自己参照 FK の埋め戻し(PK 値 -> 列キー -> 値)。 */
    const pending: { pk: unknown; values: Record<string, unknown> }[] = [];
    let cursor: unknown;
    let offset = 0;
    let rows = firstBatch;

    for (;;) {
      const values = rows.map((row) => {
        if (plan.selfRefKeys.length === 0) return row;
        const copy = { ...row };
        const deferred: Record<string, unknown> = {};
        for (const key of plan.selfRefKeys) {
          if (copy[key] == null) continue;
          deferred[key] = copy[key];
          copy[key] = null;
        }
        if (Object.keys(deferred).length > 0 && singlePk !== undefined) {
          pending.push({ pk: row[plan.pkKeys[0] as string], values: deferred });
        }
        return copy;
      });

      await tx.insert(plan.table).values(values as never);
      copied += rows.length;

      if (rows.length < effectiveBatch) break;
      if (singlePk !== undefined) {
        cursor = rows[rows.length - 1]?.[plan.pkKeys[0] as string];
      } else {
        offset += rows.length;
      }
      rows = await readBatch(cursor, offset);
      if (rows.length === 0) break;
    }

    for (const entry of pending) {
      if (singlePk === undefined) continue;
      await tx
        .update(plan.table)
        .set(entry.values as never)
        .where(eq(singlePk, entry.pk));
    }
  });
  return copied;
}

/**
 * コピー元(SQLite)からコピー先(PostgreSQL)へ全テーブルをコピーする。**移行の中核**。
 *
 * 呼び出し前に移行先のマイグレーションを適用しておくこと(`migrateDataToPostgres` はそれも行う)。
 * コピー元には書き込まない。
 *
 * @param source マイグレーション適用済みの SQLite ハンドル(`createDatabase` で開いたもの)
 * @param target マイグレーション適用済みで**空の** PostgreSQL ハンドル
 * @returns 行数とチェックサムの検証レポート
 */
export async function copyDatabase(source: DatabaseHandle, target: DatabaseHandle, options?: CopyDatabaseOptions): Promise<MigrationReport> {
  const log = options?.log ?? ((line: string) => console.log(line));
  const batchSize = options?.batchSize ?? DEFAULT_BATCH_SIZE;
  if (source.dialect !== "sqlite") throw new Error(`migrate-data: the source must be SQLite/libSQL, got: ${source.dialect}`);
  if (target.dialect !== "postgres") throw new Error(`migrate-data: the target must be PostgreSQL, got: ${target.dialect}`);

  const plans = buildTablePlans();
  const started = Date.now();

  await verifySchemaVersions(source, target, plans);
  await assertNoSequences(target);
  await assertTargetEmpty(target, plans);
  log(`schema check ok — ${plans.length} tables, target is empty`);

  const tables: TableCopyResult[] = [];
  let totalRows = 0;
  for (const plan of plans) {
    const copied = await copyTable(source, target, plan, batchSize);
    totalRows += copied;
    tables.push({ table: plan.name, sourceRows: copied, targetRows: 0 });
    if (copied > 0) log(`copied ${plan.name}: ${copied} rows`);
  }

  // 検証: 行数は「コピーした件数」ではなく両側を数え直して比べる
  const mismatched: string[] = [];
  for (const result of tables) {
    const sourceRows = await countRows(source.client, result.table);
    const targetRows = await countRows(target.client, result.table);
    result.sourceRows = sourceRows;
    result.targetRows = targetRows;
    if (sourceRows !== targetRows) mismatched.push(`${result.table}: source=${sourceRows} target=${targetRows}`);
  }

  const checksums: ChecksumComparison[] = [];
  for (const spec of CHECKSUM_TARGETS) {
    const sourceChecksum = await checksum(source.client, spec.table, spec.column);
    const targetChecksum = await checksum(target.client, spec.table, spec.column);
    const matched =
      sourceChecksum.count === targetChecksum.count &&
      sourceChecksum.sum === targetChecksum.sum &&
      sourceChecksum.minId === targetChecksum.minId &&
      sourceChecksum.maxId === targetChecksum.maxId;
    checksums.push({ table: spec.table, column: spec.column, source: sourceChecksum, target: targetChecksum, matched });
    if (!matched) mismatched.push(`${spec.table}: checksum mismatch`);
  }

  const report: MigrationReport = { tables, checksums, totalRows, durationMs: Date.now() - started };
  if (mismatched.length > 0) {
    log(formatMigrationReport(report));
    throw new Error(
      "migrate-data: verification failed after copying:\n" +
        mismatched.map((m) => `  - ${m}`).join("\n") +
        "\nThe target database is now in an unknown state — drop it, recreate it empty, and retry. " +
        "The source SQLite database was not modified.",
    );
  }
  return report;
}

/** `migrateDataToPostgres()` のオプション。 */
export interface MigrateDataOptions extends CopyDatabaseOptions {
  /** コピー元。`file:./kizami.db` / `libsql://…` */
  from: string;
  /** コピー先。`postgres://…` */
  to: string;
  /** PostgreSQL 側のスキーマ名(search_path を切り替えて運用している場合) */
  pgSchema?: string;
}

/**
 * URL を受け取って移行を最初から最後まで行う(CLI の実体)。
 *
 * 1. コピー元を**マイグレーションを流さずに**開く(読み取りのみ)
 * 2. コピー先にマイグレーション(migrations-pg/)を適用する
 * 3. `copyDatabase()` で検証・コピー・再検証を行う
 * 4. どちらの接続も閉じる
 *
 * **アプリを停止してから実行すること**(移行中の書き込みは移行先に載らない)。
 */
export async function migrateDataToPostgres(options: MigrateDataOptions): Promise<MigrationReport> {
  const source = await createDatabase(options.from);
  try {
    const target = await migrateDb({
      url: options.to,
      ...(options.pgSchema !== undefined ? { pgSchema: options.pgSchema } : {}),
    });
    try {
      return await copyDatabase(source, target, options);
    } finally {
      await target.client.close();
    }
  } finally {
    await source.client.close();
  }
}

/** レポートを人が読む表にする(CLI が最後に出力する検証レポート)。 */
export function formatMigrationReport(report: MigrationReport): string {
  const width = Math.max(...report.tables.map((t) => t.table.length), 10);
  const lines = ["", "verification report", "-".repeat(width + 26)];
  for (const table of report.tables) {
    const mark = table.sourceRows === table.targetRows ? "ok" : "MISMATCH";
    lines.push(`${table.table.padEnd(width)}  source=${String(table.sourceRows).padStart(8)}  target=${String(table.targetRows).padStart(8)}  ${mark}`);
  }
  lines.push("-".repeat(width + 26));
  for (const entry of report.checksums) {
    lines.push(
      `checksum ${entry.table} (${entry.column}): ${entry.matched ? "ok" : "MISMATCH"}\n` +
        `  source count=${entry.source.count} sum=${entry.source.sum} id=[${entry.source.minId} .. ${entry.source.maxId}]\n` +
        `  target count=${entry.target.count} sum=${entry.target.sum} id=[${entry.target.minId} .. ${entry.target.maxId}]`,
    );
  }
  lines.push(`${report.totalRows} rows in ${report.tables.length} tables, ${report.durationMs} ms`);
  return lines.join("\n");
}
