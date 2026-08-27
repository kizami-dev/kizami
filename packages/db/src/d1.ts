/**
 * Cloudflare D1 バインディングから DB ハンドルを作る(3つめのダイアレクト、2026-08-27 追加)。
 *
 * ## なぜ URL ではなくバインディングなのか
 *
 * SQLite(libSQL)と PostgreSQL は `DATABASE_URL` のスキームでダイアレクトが決まる
 * (src/dialect.ts)が、D1 に接続 URL は存在しない。Workers は `env.DB` として
 * **バインディングオブジェクト**を受け取るため、エントリポイント(apps/api/src/workers.ts)が
 * それをそのまま渡す形にしてある。したがって `resolveDialect()` が "d1" を返すことはない。
 *
 * ## マイグレーションはここでは流さない
 *
 * D1 のマイグレーションは **デプロイ時に wrangler が適用する**(`wrangler d1 migrations apply`)。
 * Workers はリクエスト単位の実行モデルで「起動時に1回だけ DDL を流す」場所が無く、
 * 同時に走る多数のアイソレートが一斉に DDL を投げるのは危険なため、起動時マイグレーションは
 * 意図的に持たない。`migrateDb()`(@kizami/db/node)も D1 ハンドルに対しては適用を skip する。
 * テストは @cloudflare/vitest-pool-workers の `applyD1Migrations()` で同じ `migrations/*.sql` を
 * 流し込む。詳細は docs/design/workers-d1.md。
 *
 * ## D1 の制約
 *
 * - **明示トランザクションが使えない**(`BEGIN` が拒否される)。drizzle の `db.transaction()` は
 *   D1 上では失敗する。KIZAMI で transaction を使っているのは招待・権限・Slack 連携・締め・
 *   休暇申請などの複数行更新で、D1 配備ではこれらが未対応(docs/design/workers-d1.md の
 *   「Node 専用」表を参照)。
 * - 1クエリあたり・1リクエストあたりのサイズ/時間制限は Workers 側の制約に従う。
 */

import { drizzle } from "drizzle-orm/d1";
import type { Database, DatabaseHandle, DbClient } from "./types.js";
import * as schema from "./schema/index.js";

/**
 * D1 バインディングの構造的な最小面。
 *
 * `@cloudflare/workers-types` のグローバル `D1Database` をこのパッケージの型解決に持ち込むと
 * `@types/node` のグローバル(fetch・Request 等)と衝突するため、必要な面だけを構造的に宣言する。
 * Workers 側の `env.DB` はこの形を満たすのでそのまま渡せる。
 */
export interface D1DatabaseBinding {
  /** SQL を1文プリペアする。 */
  prepare(query: string): {
    bind(...values: unknown[]): unknown;
    all(): Promise<{ results: unknown[] }>;
  };
  /** 複数のプリペア済みステートメントをまとめて実行する。 */
  batch(statements: unknown[]): Promise<unknown[]>;
}

/**
 * D1 バインディングから DB ハンドルを作る(マイグレーションは適用しない — 冒頭コメント参照)。
 *
 * @param binding Workers の `env.DB`(wrangler.jsonc の `d1_databases[].binding`)
 */
export function createD1Database(binding: D1DatabaseBinding): DatabaseHandle {
  const client: DbClient = {
    execute: async (sql) => {
      const { results } = await binding.prepare(sql).all();
      return { rows: results as Record<string, unknown>[] };
    },
    // D1 は接続プールを持たない(バインディング経由の RPC)ので閉じるものが無い
    close: async () => {},
  };
  return {
    // 代表型は libSQL 版(src/types.ts)。実体は drizzle-orm/d1 だが、
    // クエリ層が使う API 面と値マッピングは sqlite-core なので一致する
    db: drizzle(binding as never, { schema }) as unknown as Database,
    dialect: "d1",
    client,
  };
}
