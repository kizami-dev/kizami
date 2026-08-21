/**
 * @libsql/client + drizzle-orm/libsql の migrator でマイグレーションを適用する。
 */

import { createClient, type Client } from "@libsql/client";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";
import { migrate as drizzleMigrate } from "drizzle-orm/libsql/migrator";
import * as schema from "./schema/index.js";

export type Database = LibSQLDatabase<typeof schema>;

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
