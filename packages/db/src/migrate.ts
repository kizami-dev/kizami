/**
 * 接続の生成とマイグレーション適用。SQLite(libSQL)と PostgreSQL の両対応。
 *
 * ダイアレクトは DATABASE_URL のスキームだけで決まる(src/dialect.ts):
 * - `file:` / `libsql:` / `:memory:` → @libsql/client + drizzle-orm/libsql、`migrations/`
 * - `postgres://` / `postgresql://` → pg(node-postgres)+ drizzle-orm/node-postgres、`migrations-pg/`
 *
 * 設計(判断点 2026-08-24。詳細と背景は docs/design/db-dialects.md):
 * - **クエリ層は単一**。src/queries/ は両ダイアレクトとも sqlite-core のテーブルオブジェクト
 *   (src/schema/)でクエリを組み立てる。KIZAMI が使う範囲(select / insert ... returning /
 *   update / delete / onConflictDoUpdate / transaction / 相関サブクエリ)の SQL 生成は
 *   PgDialect でも同一結果になり、列の値マッピング(boolean は 0/1、JSON は TEXT)も
 *   両ダイアレクトで一致するよう pg 側の DDL を寄せてある。唯一ズレる JOIN の別名だけ
 *   src/alias.ts で吸収している。
 * - **pg-core のスキーマは DDL 専用**(src/schema-pg/)。sqlite-core 定義から実行時生成し、
 *   drizzle-kit の `migrations-pg/` 生成と drift テストにだけ使う。
 * - したがって `Database` 型は libSQL 版を「代表型」として使う。PostgreSQL 実体を返すときは
 *   ここで一度だけキャストし、呼び出し側(apps/api・src/queries/)は差を意識しない。
 */

import { createClient, type Client as LibsqlClient } from "@libsql/client";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";
import { migrate as libsqlMigrate } from "drizzle-orm/libsql/migrator";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { migrate as pgMigrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { resolveDialect, type DbDialect } from "./dialect.js";
import * as schema from "./schema/index.js";

/**
 * KIZAMI の DB ハンドル。
 *
 * 実体は libSQL 版 / PostgreSQL 版のどちらかだが、クエリ層が使う API 面は同一なので
 * libSQL 版の型を代表として使う(上のファイル冒頭コメント参照)。
 */
export type Database = LibSQLDatabase<typeof schema>;

/**
 * `db.transaction(async (tx) => ...)` のコールバック引数の型。
 * 複数テーブルへの書き込みをアトミックに行うクエリ関数(insertAuditLog 等)は
 * `Database | Transaction` を受け取れるようにして、通常呼び出しとトランザクション内
 * 呼び出しの両方に対応する。
 */
export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

/**
 * ダイアレクト非依存の最小クライアント。`migrateDb` / `createDatabase` の戻り値で返す。
 *
 * drizzle を通さない生 SQL(テストのスキーマ確認など)と後始末だけを提供する。
 * 以前は @libsql/client の `Client` をそのまま返していたが、PostgreSQL でも同じ形で
 * 扱えるようにここで最小面に絞った。
 */
export interface DbClient {
  /** 生 SQL を1文実行して行を返す。 */
  execute(sql: string): Promise<{ rows: Record<string, unknown>[] }>;
  /** 接続を閉じる。 */
  close(): Promise<void>;
}

/** `migrateDb` / `createDatabase` の戻り値。 */
export interface DatabaseHandle {
  db: Database;
  client: DbClient;
  dialect: DbDialect;
}

const SQLITE_MIGRATIONS_FOLDER = new URL("../migrations", import.meta.url).pathname;
const PG_MIGRATIONS_FOLDER = new URL("../migrations-pg", import.meta.url).pathname;

/** ダイアレクト既定のマイグレーションフォルダ。 */
export function defaultMigrationsFolder(dialect: DbDialect): string {
  return dialect === "postgres" ? PG_MIGRATIONS_FOLDER : SQLITE_MIGRATIONS_FOLDER;
}

/** 接続オプション。 */
export interface CreateDatabaseOptions {
  /** 接続 URL。省略時は SQLite の in-memory。 */
  url?: string;
  /** libSQL(Turso 等)の認証トークン。SQLite のときのみ意味を持つ。 */
  authToken?: string;
  /**
   * PostgreSQL のスキーマ名(既定 "public")。テストが1つの DB を並行に使い分けるための
   * 逃げ道で、本番配備で指定する必要はない。指定するとそのスキーマを作成し、
   * 接続の search_path をそれだけに固定する。
   */
  pgSchema?: string;
  /** pg プールの最大接続数(既定 10)。 */
  pgPoolMax?: number;
  /** アイドル接続を閉じるまでのミリ秒(既定は node-postgres のまま)。 */
  pgIdleTimeoutMillis?: number;
}

/**
 * libsql クライアントから Drizzle DB インスタンスを作る(マイグレーションは適用しない)。
 *
 * @deprecated 新規コードは `createDatabase` を使うこと。既存の呼び出し互換のために残している。
 */
export function createDb(client: LibsqlClient): Database {
  return drizzle(client, { schema });
}

function createLibsql(options: CreateDatabaseOptions): DatabaseHandle {
  const client = createClient({
    url: options.url ?? ":memory:",
    ...(options.authToken !== undefined ? { authToken: options.authToken } : {}),
  });
  return {
    db: drizzle(client, { schema }),
    dialect: "sqlite",
    client: {
      execute: async (sql) => {
        const result = await client.execute(sql);
        return { rows: result.rows as unknown as Record<string, unknown>[] };
      },
      close: async () => {
        client.close();
      },
    },
  };
}

async function createPostgres(options: CreateDatabaseOptions): Promise<DatabaseHandle> {
  const pgSchema = options.pgSchema;
  if (pgSchema !== undefined && !/^[a-z_][a-z0-9_]*$/.test(pgSchema)) {
    // search_path へ素の文字列で埋め込むため、識別子として安全な形だけ許可する
    throw new Error(`pgSchema must be a lowercase identifier, got: ${pgSchema}`);
  }

  const pool = new Pool({
    connectionString: options.url,
    max: options.pgPoolMax ?? 10,
    ...(options.pgIdleTimeoutMillis !== undefined ? { idleTimeoutMillis: options.pgIdleTimeoutMillis, allowExitOnIdle: true } : {}),
    ...(pgSchema !== undefined ? { options: `-c search_path=${pgSchema}` } : {}),
  });

  // search_path は存在しないスキーマを指していてもエラーにならないので、
  // 同じプールで先にスキーマを作ってしまってよい(接続を余分に開かない)
  if (pgSchema !== undefined) await pool.query(`CREATE SCHEMA IF NOT EXISTS "${pgSchema}"`);

  return {
    // 代表型は libSQL 版(ファイル冒頭コメント)。実体は node-postgres だが、
    // クエリ層が使う API 面と値マッピングは一致する
    db: drizzlePg(pool, { schema }) as unknown as Database,
    dialect: "postgres",
    client: {
      execute: async (sql) => {
        const result = await pool.query(sql);
        return { rows: result.rows as Record<string, unknown>[] };
      },
      close: async () => {
        await pool.end();
      },
    },
  };
}

/**
 * 接続 URL からダイアレクトを判定して DB ハンドルを作る(マイグレーションは適用しない)。
 *
 * @param url `file:./kizami.db` / `libsql://...` / `postgres://user:pass@host/db` など。
 *            省略時は SQLite の in-memory
 */
export async function createDatabase(url?: string, options?: Omit<CreateDatabaseOptions, "url">): Promise<DatabaseHandle> {
  const merged: CreateDatabaseOptions = { ...options, ...(url !== undefined ? { url } : {}) };
  return resolveDialect(url) === "postgres" ? createPostgres(merged) : createLibsql(merged);
}

/**
 * 指定した接続先(既定は SQLite の in-memory)にマイグレーションを適用し、DB ハンドルを返す。
 *
 * マイグレーションフォルダはダイアレクトごとに別系統(`migrations/` と `migrations-pg/`)。
 */
export async function migrateDb(
  options?: CreateDatabaseOptions & { migrationsFolder?: string },
): Promise<DatabaseHandle> {
  const handle = await createDatabase(options?.url, options);
  const migrationsFolder = options?.migrationsFolder ?? defaultMigrationsFolder(handle.dialect);

  if (handle.dialect === "postgres") {
    await pgMigrate(handle.db as never, {
      migrationsFolder,
      // テストがスキーマ単位で分離できるよう、履歴テーブルも同じスキーマへ置く
      ...(options?.pgSchema !== undefined ? { migrationsSchema: options.pgSchema } : {}),
    });
  } else {
    await libsqlMigrate(handle.db, { migrationsFolder });
  }
  return handle;
}
