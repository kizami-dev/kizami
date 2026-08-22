/**
 * テナント単位の通知チャネル設定(tenant_notification_settings)から NotificationChannel[] を
 * 組み立てる共通ロジック。src/worker.ts(定期リマインドスキャン)と
 * src/routes/settings.ts(POST /settings/notifications/test)の両方から使う。
 *
 * 環境変数 WEBHOOK_URL は「DB設定が(そのテナントに)一切無い場合のフォールバック」としてのみ
 * 使う(DB に行があり webhookEnabled=false の場合は、明示的な無効化として尊重しフォールバック
 * しない)。
 *
 * webhookUrl / smtpPassword は保存時に暗号化されている想定(apps/api/src/lib/encryption.ts)。
 * ここで復号し、復号できない場合(鍵未設定・鍵不一致・破損)は該当チャネルを組み立てず
 * console.warn で警告するだけに留める(通知が止まるだけで、他のチャネル・システム全体は
 * 動き続ける — 復号失敗を例外にしない)。
 */

import { getNotificationSettings, type Database, type TenantNotificationSettings } from "@kizami/db";
import { createSmtpChannel, webhookChannel, type NotificationChannel, type SmtpSendFn } from "@kizami/notify";
import { decryptSecret, type Encryptor } from "./encryption.js";

export interface BuildNotificationChannelsOptions {
  /** webhookChannel の fetch 差し替え(テスト用)。省略時はグローバル fetch */
  fetchImpl?: typeof fetch;
  /** smtp 送信関数(Node なら apps/api/src/lib/smtp.ts の nodemailerSendFn、テストなら偽実装)。省略時 smtp チャネルは作らない */
  smtpSendFn?: SmtpSendFn;
  /** テナントに tenant_notification_settings の行が1つも無い場合だけ使う webhook URL フォールバック(環境変数 WEBHOOK_URL) */
  webhookUrlFallback?: string;
  /** webhookUrl・smtpPassword の復号に使う。省略/null の場合、暗号化済みの値は復号できず該当チャネルを無効化する */
  encryptor?: Encryptor | null;
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
      const url = await decryptSecret(options.encryptor, settings.webhookUrl);
      if (url) {
        channels.push(webhookChannel(url, options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}));
      } else {
        console.warn(
          `[notification-channels] tenant ${tenantId}: webhookUrl could not be decrypted (missing/rotated key or corrupted value); disabling the webhook channel`,
        );
      }
    }
    if (settings.smtpEnabled && settings.smtpHost && settings.smtpPort && settings.smtpFrom && options.smtpSendFn) {
      // 元々パスワードが設定されていたのに復号できなかった場合は、認証無しで送るのではなく
      // チャネルごと無効化する(意図しない未認証送信を避けるため)。
      let smtpPasswordUnavailable = false;
      let password: string | undefined;
      if (settings.smtpPassword) {
        const decrypted = await decryptSecret(options.encryptor, settings.smtpPassword);
        if (decrypted === null) {
          smtpPasswordUnavailable = true;
          console.warn(
            `[notification-channels] tenant ${tenantId}: smtpPassword could not be decrypted (missing/rotated key or corrupted value); disabling the smtp channel`,
          );
        } else {
          password = decrypted;
        }
      }

      if (!smtpPasswordUnavailable) {
        channels.push(
          createSmtpChannel(
            {
              host: settings.smtpHost,
              port: settings.smtpPort,
              from: settings.smtpFrom,
              ...(settings.smtpUser ? { user: settings.smtpUser } : {}),
              ...(password ? { password } : {}),
            },
            options.smtpSendFn,
          ),
        );
      }
    }
  } else if (options.webhookUrlFallback) {
    channels.push(webhookChannel(options.webhookUrlFallback, options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}));
  }

  return channels;
}
