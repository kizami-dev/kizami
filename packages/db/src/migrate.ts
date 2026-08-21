/**
 * @libsql/client + drizzle-orm/libsql の migrator でマイグレーションを適用する。
 */

import { createClient, type Client } from "@libsql/client";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";
import { migrate as drizzleMigrate } from "drizzle-orm/libsql/migrator";
import * as schema from "./schema/index.js";

export type Database = LibSQLDatabase<typeof schema>;

/**
 * `db.transaction(async (tx) => ...)` のコールバック引数の型。
 * 複数テーブルへの書き込みをアトミックに行うクエリ関数(insertAuditLog 等)は
 * `Database | Transaction` を受け取れるようにして、通常呼び出しとトランザクション内
 * 呼び出しの両方に対応する。
 */
export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

const DEFAULT_MIGRATIONS_FOLDER = new URL("../migrations", import.meta.url).pathname;

/**
 * libsql クライアントから Drizzle DB インスタンスを作る(マイグレーションは適用しない)。
 */
export function createDb(client: Client): Database {
  return drizzle(client, { schema });
}

/**
 * 指定した接続先(既定は in-memory)に対してマイグレーションを適用し、Drizzle DB を返す。
 */
export async function migrateDb(options?: {
  url?: string;
  authToken?: string;
  migrationsFolder?: string;
}): Promise<{ db: Database; client: Client }> {
  const client = createClient({
    url: options?.url ?? ":memory:",
    ...(options?.authToken !== undefined ? { authToken: options.authToken } : {}),
  });
  const db = createDb(client);
  await drizzleMigrate(db, { migrationsFolder: options?.migrationsFolder ?? DEFAULT_MIGRATIONS_FOLDER });
  return { db, client };
}
