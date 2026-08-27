/**
 * OIDC(SSO ログイン)のテナント単位設定に対するクエリ層。
 * tenant_slack_settings と同じ「テナントにつき1行・丸ごと置き換え」の形にそろえてある。
 */

import { eq } from "drizzle-orm";
import type { Database } from "../types.js";
import { tenantOidcSettings } from "../schema/index.js";

export type TenantOidcSettings = typeof tenantOidcSettings.$inferSelect;

/** 指定テナントの OIDC 設定を返す(未設定なら null)。 */
export async function getTenantOidcSettings(db: Database, tenantId: string): Promise<TenantOidcSettings | null> {
  const rows = await db.select().from(tenantOidcSettings).where(eq(tenantOidcSettings.tenantId, tenantId)).limit(1);
  return rows[0] ?? null;
}

export interface UpsertTenantOidcSettingsInput {
  tenantId: string;
  issuer: string | null;
  clientId: string | null;
  /** 暗号化済み("enc:v1:...")の値を受け取る。平文/暗号文の判断は呼び出し側の責務 */
  clientSecret: string | null;
  enabled: boolean;
  allowUnverifiedEmail: boolean;
  updatedAt: number;
  updatedBy: string;
}

/** テナントの OIDC 設定を作成、または既存行を丸ごと置き換える(部分更新ではない)。 */
export async function upsertTenantOidcSettings(
  db: Database,
  input: UpsertTenantOidcSettingsInput,
): Promise<TenantOidcSettings> {
  const values = {
    tenantId: input.tenantId,
    issuer: input.issuer,
    clientId: input.clientId,
    clientSecret: input.clientSecret,
    enabled: input.enabled,
    allowUnverifiedEmail: input.allowUnverifiedEmail,
    updatedAt: input.updatedAt,
    updatedBy: input.updatedBy,
  };

  const [row] = await db
    .insert(tenantOidcSettings)
    .values(values)
    .onConflictDoUpdate({ target: tenantOidcSettings.tenantId, set: values })
    .returning();
  if (!row) {
    throw new Error("upsertTenantOidcSettings: insert/update returned no row");
  }
  return row;
}
