/**
 * user_notification_settings に対するクエリ層。
 *
 * 1テナント×1ユーザーにつき最新の1件を保持する現在値テーブル(help_overrides と同じ考え方、
 * 改訂履歴は持たない)。行が無い = 未設定(既定値を使う。既定値の定義は
 * apps/api/src/lib/notification-preferences.ts に一元化 — packages/db は API 層の
 * デフォルト値を持ち込まない独立レイヤの原則を保つ)。
 */

import { and, eq } from "drizzle-orm";
import type { Database } from "../migrate.js";
import { userNotificationSettings } from "../schema/index.js";

export type UserNotificationSettings = typeof userNotificationSettings.$inferSelect;

/** 指定テナント・ユーザーの個人通知設定を返す(未設定なら null)。 */
export async function getUserNotificationSettings(
  db: Database,
  params: { tenantId: string; userId: string },
): Promise<UserNotificationSettings | null> {
  const rows = await db
    .select()
    .from(userNotificationSettings)
    .where(and(eq(userNotificationSettings.tenantId, params.tenantId), eq(userNotificationSettings.userId, params.userId)))
    .limit(1);
  return rows[0] ?? null;
}

export interface UpsertUserNotificationSettingsInput {
  tenantId: string;
  userId: string;
  missingClockOutEmail: boolean;
  missingClockOutWebhook: boolean;
  overtimeAlertEmail: boolean;
  overtimeAlertWebhook: boolean;
  leaveAlertEmail: boolean;
  leaveAlertWebhook: boolean;
  correctionAlertEmail: boolean;
  correctionAlertWebhook: boolean;
  emailAddress: string | null;
  webhookUrl: string | null;
  /** UTC エポック分 */
  updatedAt: number;
}

/** 作成、または既存行を丸ごと置き換える(PK は (tenant_id, user_id))。部分更新ではない — 呼び出し側で完全な値を渡すこと。 */
export async function upsertUserNotificationSettings(
  db: Database,
  input: UpsertUserNotificationSettingsInput,
): Promise<UserNotificationSettings> {
  const values = {
    tenantId: input.tenantId,
    userId: input.userId,
    missingClockOutEmail: input.missingClockOutEmail,
    missingClockOutWebhook: input.missingClockOutWebhook,
    overtimeAlertEmail: input.overtimeAlertEmail,
    overtimeAlertWebhook: input.overtimeAlertWebhook,
    leaveAlertEmail: input.leaveAlertEmail,
    leaveAlertWebhook: input.leaveAlertWebhook,
    correctionAlertEmail: input.correctionAlertEmail,
    correctionAlertWebhook: input.correctionAlertWebhook,
    emailAddress: input.emailAddress,
    webhookUrl: input.webhookUrl,
    updatedAt: input.updatedAt,
  };

  const [row] = await db
    .insert(userNotificationSettings)
    .values(values)
    .onConflictDoUpdate({ target: [userNotificationSettings.tenantId, userNotificationSettings.userId], set: values })
    .returning();
  if (!row) {
    throw new Error("upsertUserNotificationSettings: insert/update returned no row");
  }
  return row;
}
