/**
 * KIZAMI DB レイヤ — **Node 専用のエントリ**(`@kizami/db/node`)。
 *
 * ランタイム非依存のエントリ(`@kizami/db` = src/index.ts)の全部に加えて、
 * @libsql/client(SQLite/libSQL)と pg(PostgreSQL)を使う接続生成・マイグレーション適用
 * (src/migrate.ts)を公開する。これらは node:net / node:fs に依存するため workerd では
 * 読み込めない — だからエントリを分けている(2026-08-27、要件 §8。docs/design/workers-d1.md)。
 *
 * Node 側の呼び出し元: apps/api/src/node.ts・worker.ts・seed.ts・create-tenant.ts、
 * および packages/db・apps/api のテスト。
 */

export * from "./index.js";
export * from "./migrate.js";
