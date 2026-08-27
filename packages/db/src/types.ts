/**
 * ダイアレクト非依存の型定義。**ここには Node 専用ドライバ(@libsql/client・pg)を持ち込まない**。
 *
 * 判断点(2026-08-27、要件 §8「Workers+D1 動作保証」):
 * 接続の生成(src/migrate.ts)は @libsql/client と pg を静的 import するため、workerd では
 * バンドルすらできない。一方で `Database` 型やクエリ層は完全にランタイム非依存なので、
 * 型と接続実装を分けて `@kizami/db`(ランタイム非依存)と `@kizami/db/node`(Node 専用)の
 * 2つのエントリに割った。詳細は docs/design/workers-d1.md。
 */

import type { LibSQLDatabase } from "drizzle-orm/libsql";
import type { DbDialect } from "./dialect.js";
import type * as schema from "./schema/index.js";

/**
 * KIZAMI の DB ハンドル。
 *
 * 実体は libSQL 版 / PostgreSQL 版 / D1 版のいずれかだが、クエリ層が使う API 面は同一なので
 * libSQL 版の型を代表として使う(型 import だけなので workerd でも読み込める)。
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
 * ダイアレクト非依存の最小クライアント。接続ファクトリの戻り値に含まれる。
 *
 * drizzle を通さない生 SQL(テストのスキーマ確認など)と後始末だけを提供する。
 * 以前は @libsql/client の `Client` をそのまま返していたが、PostgreSQL/D1 でも同じ形で
 * 扱えるようにここで最小面に絞った。
 */
export interface DbClient {
  /** 生 SQL を1文実行して行を返す。 */
  execute(sql: string): Promise<{ rows: Record<string, unknown>[] }>;
  /** 接続を閉じる(D1 は接続を持たないので no-op)。 */
  close(): Promise<void>;
}

/** 接続ファクトリ(`createDatabase` / `migrateDb` / `createD1Database`)の戻り値。 */
export interface DatabaseHandle {
  db: Database;
  client: DbClient;
  dialect: DbDialect;
}
