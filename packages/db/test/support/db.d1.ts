/**
 * テスト用の DB ハンドル生成 — **Cloudflare D1 レグ専用**の support/db.ts 置き換え。
 *
 * 判断点(2026-08-27、要件 §9「同一スイートを3ダイアレクトで実行」):
 * packages/db のテストは全ファイルが `./support/db.js` の `migrateDb()` 経由で DB を作るので、
 * その1ファイルだけを差し替えれば **テストファイルを一切変えずに** D1 でも同じスイートを
 * 走らせられる。差し替えは vitest.d1.config.ts の `resolve.alias` で行う(Node レグからは
 * このファイルは一切見えない)。
 *
 * 本家(support/db.ts)との違い:
 * - `@libsql/client` / `pg` を読まない。workerd ではドライバごとバンドルできないため
 * - マイグレーションは `applyD1Migrations()` で1回だけ流す。D1 は Worker あたり
 *   1バインディング = 1データベースで、呼び出しごとに空の DB を作れない
 * - 代わりに **呼び出しのたびに全テーブルを空にする**。従来 `migrateDb()` が
 *   「まっさらな DB」を返していた前提をこれで満たす
 */

import { applyD1Migrations, env } from "cloudflare:test";
import { createD1Database } from "../../src/d1.js";
import type { DatabaseHandle } from "../../src/types.js";

export type { Database, DatabaseHandle, Transaction } from "../../src/types.js";

/** support/db.ts と同じ名前で export する(テストが参照しても壊れないように)。 */
export const TEST_PG_SCHEMA_PREFIX = "kizami_test_";
/**
 * D1 は明示トランザクション(`BEGIN`/`COMMIT`/`SAVEPOINT`)を拒否する。
 * `db.transaction()` を使うテストはこのフラグで D1 レグから外す(support/db.ts の同名 export の
 * 説明と docs/design/workers-d1.md を参照)。
 */
export const supportsTransactions = false;

/** D1 レグは PostgreSQL レグではない。 */
export const isPostgresTestRun = false;
/** D1 レグでは使わない。 */
export const testPgUrl: string | undefined = undefined;

/**
 * 空にしてはいけないテーブル。
 * - `d1_migrations`: applyD1Migrations() が作る適用履歴
 * - `_cf_*`: D1 の内部テーブル。触ると `SQLITE_AUTH: not authorized` になる
 * - `sqlite_*`: SQLite の内部カタログ
 */
function isInternalTable(name: string): boolean {
  return name === "d1_migrations" || name.startsWith("_") || name.startsWith("sqlite_");
}

let migrated = false;

async function listTables(handle: DatabaseHandle): Promise<string[]> {
  const { rows } = await handle.client.execute("SELECT name FROM sqlite_master WHERE type = 'table'");
  return rows.map((row) => row.name as string).filter((name) => !isInternalTable(name));
}

/**
 * 全テーブルを空にする。
 *
 * D1 は外部キー制約を強制するため単純な DELETE の羅列は順序次第で
 * `FOREIGN KEY constraint failed` になる。`batch()` は暗黙のトランザクションで走るので、
 * 先頭に `PRAGMA defer_foreign_keys = on` を置けば制約の検査をバッチ末尾まで遅延できる
 * (D1 が明示トランザクションの代わりに提供している唯一の原子的実行手段)。
 */
async function truncateAll(tables: string[]): Promise<void> {
  await env.DB.batch([
    env.DB.prepare("PRAGMA defer_foreign_keys = on"),
    ...tables.map((table) => env.DB.prepare(`DELETE FROM "${table}"`)),
  ]);
}

/**
 * マイグレーション済みで**空**の DB ハンドルを返す。`migrateDb` のドロップイン置き換え。
 *
 * @param _options SQLite/PostgreSQL 用の接続オプション。D1 は接続先がバインディング固定なので無視する
 */
export async function migrateDb(_options?: unknown): Promise<DatabaseHandle> {
  const handle = createD1Database(env.DB);
  if (!migrated) {
    // 本番では `wrangler d1 migrations apply` がデプロイ時に流す工程(src/d1.ts 冒頭)
    await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
    migrated = true;
  }
  await truncateAll(await listTables(handle));
  return handle;
}
