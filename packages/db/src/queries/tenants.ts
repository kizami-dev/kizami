/**
 * tenants に対する最小限のクエリ層(法令プロファイル・特別条項フラグの読み書き)。
 *
 * 参照: packages/db/src/schema/tenants.ts のコメント(3列を直接持たせている理由)。
 */

import { eq } from "drizzle-orm";
import type { Database, Transaction } from "../migrate.js";
import { tenants } from "../schema/index.js";

export type Tenant = typeof tenants.$inferSelect;

/** id で1件取得する(存在しなければ null)。 */
export async function getTenantById(db: Database | Transaction, tenantId: string): Promise<Tenant | null> {
  const [row] = await db.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  return row ?? null;
}

export interface UpdateTenantLawProfileParams {
  tenantId: string;
  isSmallOrMediumEnterprise: boolean;
  isSpecialProvisionWorkplace: boolean;
  specialClauseEnabled: boolean;
}

/**
 * 法令プロファイル・特別条項フラグを更新する(UPDATE、追記専用ではない — 現在値のみを持つ)。
 * 呼び出し側(apps/api/src/routes/settings.ts)が監査ログへの記録を担う。
 */
export async function updateTenantLawProfile(db: Database | Transaction, params: UpdateTenantLawProfileParams): Promise<Tenant> {
  const [row] = await db
    .update(tenants)
    .set({
      isSmallOrMediumEnterprise: params.isSmallOrMediumEnterprise,
      isSpecialProvisionWorkplace: params.isSpecialProvisionWorkplace,
      specialClauseEnabled: params.specialClauseEnabled,
    })
    .where(eq(tenants.id, params.tenantId))
    .returning();
  if (!row) {
    throw new Error(`updateTenantLawProfile: tenant not found: ${params.tenantId}`);
  }
  return row;
}
