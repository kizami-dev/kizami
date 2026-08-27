/**
 * `cloudflare:test`(@cloudflare/vitest-pool-workers が workerd 内で提供する仮想モジュール)の
 * 最小アンビエント宣言。support/db.d1.ts(D1 レグ専用)だけが使う。
 *
 * 公式には `@cloudflare/vitest-pool-workers/types` と `@cloudflare/workers-types` を
 * tsconfig の types に足す想定だが、それをやると @types/node のグローバルと二重定義になり
 * パッケージ全体の型検査が壊れる。ここで使う面だけを構造的に宣言してその衝突を避ける。
 */
declare module "cloudflare:test" {
  import type { D1DatabaseBinding } from "../../src/d1.js";

  /** vitest.d1.config.ts の miniflare.bindings / d1Databases。 */
  export const env: {
    DB: D1DatabaseBinding;
    /** readD1Migrations() が読んだ migrations/*.sql。 */
    TEST_MIGRATIONS: unknown;
  };

  /** D1 にマイグレーションを適用する(本番では wrangler がデプロイ時に行う工程)。 */
  export function applyD1Migrations(db: D1DatabaseBinding, migrations: unknown): Promise<void>;
}
