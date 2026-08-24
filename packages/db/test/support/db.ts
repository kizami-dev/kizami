/**
 * テスト用の DB ハンドル生成。**全テストファイルはここ経由で DB を作る**。
 *
 * 同じテストコードを SQLite と PostgreSQL の両方で走らせるための唯一の分岐点で、
 * ダイアレクトは環境変数 `KIZAMI_TEST_DIALECT`(vitest.config.ts の projects が渡す)で決まる:
 *
 * - 既定(sqlite): `src/migrate.ts` の `migrateDb` をそのまま呼ぶ。引数も挙動も従来どおり
 *   (in-memory / `file:` の使い分けも呼び出し側のまま)
 * - postgres: `TEST_PG_URL` へ接続し、**呼び出しごとに専用スキーマ**を作ってそこへ
 *   マイグレーションを流す。呼び出し側が渡した `url`(in-memory / 一時ファイル)は無視する。
 *   スキーマ分離にしているのは、vitest がテストファイルを並列に走らせても互いの
 *   テーブルを壊さないようにするため(DB を分けるより速く、後片付けも一括でできる)。
 *
 * 接続数: プールは `max: 2` / `idleTimeoutMillis: 500` / `allowExitOnIdle` にしてあり、
 * テストが明示的に close しなくてもアイドル接続は自動で返る(テスト1件ごとにプールを
 * 作るため、閉じ忘れると max_connections を食い潰す)。
 */

import { migrateDb as migrateRealDb, type CreateDatabaseOptions, type DatabaseHandle } from "../../src/migrate.js";

export type { Database, DatabaseHandle, Transaction } from "../../src/migrate.js";

/** テスト用に切ったスキーマの接頭辞。globalSetup がこの接頭辞のスキーマを一括削除する。 */
export const TEST_PG_SCHEMA_PREFIX = "kizami_test_";

/** このプロセスが PostgreSQL 側を叩くかどうか。 */
export const isPostgresTestRun = process.env.KIZAMI_TEST_DIALECT === "postgres";

/** PostgreSQL テストの接続先(未設定なら PostgreSQL レグは動かない)。 */
export const testPgUrl = process.env.TEST_PG_URL;

let schemaCounter = 0;

/**
 * マイグレーション済みの DB ハンドルを返す。`migrateDb` のドロップイン置き換え。
 *
 * @param options SQLite のときだけ意味を持つ(PostgreSQL では接続先を TEST_PG_URL に固定するため)
 */
export async function migrateDb(options?: CreateDatabaseOptions & { migrationsFolder?: string }): Promise<DatabaseHandle> {
  if (!isPostgresTestRun) return migrateRealDb(options);

  if (testPgUrl === undefined) {
    throw new Error("KIZAMI_TEST_DIALECT=postgres なのに TEST_PG_URL が未設定です");
  }
  schemaCounter += 1;
  const schema = `${TEST_PG_SCHEMA_PREFIX}${process.pid}_${schemaCounter}`;
  return migrateRealDb({
    url: testPgUrl,
    pgSchema: schema,
    pgPoolMax: 2,
    pgIdleTimeoutMillis: 500,
  });
}
