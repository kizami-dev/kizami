/**
 * `cloudflare:test`(@cloudflare/vitest-pool-workers が workerd 内で提供する仮想モジュール)の
 * 最小アンビエント宣言。
 *
 * 公式には `@cloudflare/vitest-pool-workers/types` と `@cloudflare/workers-types` を
 * tsconfig の types に足す想定だが、それをやると @types/node のグローバル(fetch・Request・
 * Response 等)と二重定義になり apps/api 全体の型検査が壊れる。ここで使う面だけを構造的に
 * 宣言してその衝突を避ける(2026-08-27、docs/design/workers-d1.md)。
 */
declare module "cloudflare:test" {
  import type { D1DatabaseBinding } from "@kizami/db";

  /** vitest.workers.config.ts の miniflare.bindings / d1Databases。 */
  export const env: {
    DB: D1DatabaseBinding;
    /** readD1Migrations() が読んだ packages/db/migrations/*.sql。 */
    TEST_MIGRATIONS: unknown;
  };

  /** `main` に指定した Worker(src/workers.ts)を実際の fetch パイプライン経由で叩く。 */
  export const SELF: {
    fetch(input: string, init?: RequestInit): Promise<Response>;
  };

  /** D1 にマイグレーションを適用する(本番では wrangler がデプロイ時に行う工程)。 */
  export function applyD1Migrations(db: D1DatabaseBinding, migrations: unknown): Promise<void>;
}
