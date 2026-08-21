/**
 * テナント単位の通知チャネル設定(tenant_notification_settings)から NotificationChannel[] を
 * 組み立てる共通ロジック。src/worker.ts(定期リマインドスキャン)と
 * src/routes/settings.ts(POST /settings/notifications/test)の両方から使う。
 *
 * 環境変数 WEBHOOK_URL は「DB設定が(そのテナントに)一切無い場合のフォールバック」としてのみ
 * 使う(DB に行があり webhookEnabled=false の場合は、明示的な無効化として尊重しフォールバック
 * しない)。
 */

import { getNotificationSettings, type Database, type TenantNotificationSettings } from "@kizami/db";
import { createSmtpChannel, webhookChannel, type NotificationChannel, type SmtpSendFn } from "@kizami/notify";

export interface BuildNotificationChannelsOptions {
  /** webhookChannel の fetch 差し替え(テスト用)。省略時はグローバル fetch */
  fetchImpl?: typeof fetch;
  /** smtp 送信関数(Node なら apps/api/src/lib/smtp.ts の nodemailerSendFn、テストなら偽実装)。省略時 smtp チャネルは作らない */
  smtpSendFn?: SmtpSendFn;
  /** テナントに tenant_notification_settings の行が1つも無い場合だけ使う webhook URL フォールバック(環境変数 WEBHOOK_URL) */
  webhookUrlFallback?: string;
}

/** 「今の保存設定で少なくとも1チャネル送信できるか」を判定する(POST /settings/notifications/test の事前チェックに使う)。 */
export function isNotificationConfigUsable(
  settings: Pick<
    TenantNotificationSettings,
    "webhookEnabled" | "webhookUrl" | "smtpEnabled" | "smtpHost" | "smtpPort" | "smtpFrom"
  > | null,
): boolean {
  if (!settings) return false;
  const webhookUsable = settings.webhookEnabled && settings.webhookUrl !== null;
  const smtpUsable = settings.smtpEnabled && settings.smtpHost !== null && settings.smtpPort !== null && settings.smtpFrom !== null;
  return webhookUsable || smtpUsable;
}

export async function buildNotificationChannels(
  db: Database,
  tenantId: string,
  options: BuildNotificationChannelsOptions = {},
): Promise<NotificationChannel[]> {
  const settings = await getNotificationSettings(db, tenantId);
  const channels: NotificationChannel[] = [];

  if (settings) {
    if (settings.webhookEnabled && settings.webhookUrl) {
      channels.push(webhookChannel(settings.webhookUrl, options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}));
    }
    if (settings.smtpEnabled && settings.smtpHost && settings.smtpPort && settings.smtpFrom && options.smtpSendFn) {
      channels.push(
        createSmtpChannel(
          {
            host: settings.smtpHost,
            port: settings.smtpPort,
            from: settings.smtpFrom,
            ...(settings.smtpUser ? { user: settings.smtpUser } : {}),
            ...(settings.smtpPassword ? { password: settings.smtpPassword } : {}),
          },
          options.smtpSendFn,
        ),
      );
    }
  } else if (options.webhookUrlFallback) {
    channels.push(webhookChannel(options.webhookUrlFallback, options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}));
  }

  return channels;
}
