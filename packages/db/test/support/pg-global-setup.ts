/**
 * PostgreSQL レグの前後始末。テストは1件ごとに `kizami_test_*` スキーマを切って捨てるので、
 * 走り始めに前回の残骸をまとめて落とし、終わりにも同じ掃除をする。
 * (テスト側に after フックを足すより確実で、失敗して落ちた実行の残骸も回収できる)
 */
import { Pool } from "pg";
import { TEST_PG_SCHEMA_PREFIX } from "./db.js";

async function dropTestSchemas(url: string): Promise<void> {
  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    const { rows } = await pool.query<{ nspname: string }>(
      "SELECT nspname FROM pg_namespace WHERE nspname LIKE $1",
      [`${TEST_PG_SCHEMA_PREFIX}%`],
    );
    for (const row of rows) {
      await pool.query(`DROP SCHEMA IF EXISTS "${row.nspname}" CASCADE`);
    }
  } finally {
    await pool.end();
  }
}

export async function setup(): Promise<void> {
  const url = process.env.TEST_PG_URL;
  if (url === undefined) return;
  await dropTestSchemas(url);
}

export async function teardown(): Promise<void> {
  const url = process.env.TEST_PG_URL;
  if (url === undefined) return;
  await dropTestSchemas(url);
}
