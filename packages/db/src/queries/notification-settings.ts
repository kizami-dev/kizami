/**
 * tenant_notification_settings に対するクエリ層。
 *
 * テナントにつき1行の設定なので getNotificationSettings は「存在しなければ null」
 * (= 未設定)を返し、upsertNotificationSettings は insert/update を一本化する
 * (onConflictDoUpdate — PK は tenant_id 単独)。
 */

import { eq } from "drizzle-orm";
import type { Database } from "../types.js";
import { tenantNotificationSettings } from "../schema/index.js";

export type TenantNotificationSettings = typeof tenantNotificationSettings.$inferSelect;

/** 指定テナントの通知設定を返す(未設定なら null)。 */
export async function getNotificationSettings(db: Database, tenantId: string): Promise<TenantNotificationSettings | null> {
  const rows = await db
    .select()
    .from(tenantNotificationSettings)
    .where(eq(tenantNotificationSettings.tenantId, tenantId))
    .limit(1);
  return rows[0] ?? null;
}

export interface UpsertNotificationSettingsInput {
  tenantId: string;
  webhookEnabled: boolean;
  webhookUrl: string | null;
  smtpEnabled: boolean;
  smtpHost: string | null;
  smtpPort: number | null;
  smtpUser: string | null;
  smtpPassword: string | null;
  smtpFrom: string | null;
  /** UTC エポック分 */
  updatedAt: number;
  updatedBy: string;
}

/** テナントの通知設定を作成、または既存行を丸ごと置き換える(部分更新ではない — 呼び出し側で既存値とマージ済みの完全な値を渡すこと)。 */
export async function upsertNotificationSettings(
  db: Database,
  input: UpsertNotificationSettingsInput,
): Promise<TenantNotificationSettings> {
  const values = {
    tenantId: input.tenantId,
    webhookEnabled: input.webhookEnabled,
    webhookUrl: input.webhookUrl,
    smtpEnabled: input.smtpEnabled,
    smtpHost: input.smtpHost,
    smtpPort: input.smtpPort,
    smtpUser: input.smtpUser,
    smtpPassword: input.smtpPassword,
    smtpFrom: input.smtpFrom,
    updatedAt: input.updatedAt,
    updatedBy: input.updatedBy,
  };

  const [row] = await db
    .insert(tenantNotificationSettings)
    .values(values)
    .onConflictDoUpdate({ target: tenantNotificationSettings.tenantId, set: values })
    .returning();
  if (!row) {
    throw new Error("upsertNotificationSettings: insert/update returned no row");
  }
  return row;
}
