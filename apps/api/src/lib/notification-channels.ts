/**
 * 通知チャネルの組み立て。宛先に応じて2つの入口に分ける
 * (docs/requirements.md §7「通知設定の2層構造」§「通知の宛先の原則」):
 *
 * - `buildPersonalChannels` — **本人宛の通知**用。個人設定(user_notification_settings)で
 *   有効なチャネルだけを返す。email はテナントの SMTP 接続情報 + 個人の宛先メールアドレス、
 *   webhook は**個人の Webhook URL のみ**(テナント共有 Webhook は絶対に使わない — ここが
 *   今回の修正の核心。以前はテナント共有 Webhook に全員分の本人宛通知が集約されていて、
 *   他人の勤怠情報が見える状態だった)。
 * - `buildTenantChannels`(旧 buildNotificationChannels) — **管理者向けの集約通知**用。
 *   テナント共有 Webhook + テナント SMTP。現状の呼び出し元は
 *   POST /settings/notifications/test(管理者が「自社のチャネル設定」を確認するテスト送信)
 *   のみ。将来の承認依頼通知など「管理者向け」の通知はこちらを使う想定
 *   (今回のスコープでは呼び出し箇所を増やさない)。
 *
 * 環境変数 WEBHOOK_URL は「buildTenantChannels 呼び出し時、そのテナントに
 * tenant_notification_settings の行が一切無い場合のフォールバック」としてのみ使う
 * (DB に行があり webhookEnabled=false の場合は、明示的な無効化として尊重しフォールバック
 * しない)。buildPersonalChannels には環境変数フォールバックは存在しない(個人設定が
 * 無ければ「アプリ内のみ」が既定 — apps/api/src/lib/notification-preferences.ts 参照)。
 *
 * webhookUrl / smtpPassword(テナント・個人とも)は保存時に暗号化されている想定
 * (apps/api/src/lib/encryption.ts)。ここで復号し、復号できない場合(鍵未設定・鍵不一致・
 * 破損)は該当チャネルを組み立てず console.warn で警告するだけに留める(通知が止まるだけで、
 * 他のチャネル・システム全体は動き続ける — 復号失敗を例外にしない)。
 */

import {
  getNotificationSettings,
  getUserById,
  getUserNotificationSettings,
  type Database,
  type TenantNotificationSettings,
} from "@kizami/db";
import { createSmtpChannel, webhookChannel, type NotificationChannel, type SmtpSendFn } from "@kizami/notify";
import { decryptSecret, type Encryptor } from "./encryption.js";
import { resolveEmailAddress, resolveNotificationCategory, resolveUserNotificationPrefs } from "./notification-preferences.js";

export interface BuildNotificationChannelsOptions {
  /** webhookChannel の fetch 差し替え(テスト用)。省略時はグローバル fetch */
  fetchImpl?: typeof fetch;
  /** smtp 送信関数(Node なら apps/api/src/lib/smtp.ts の nodemailerSendFn、テストなら偽実装)。省略時 smtp チャネルは作らない */
  smtpSendFn?: SmtpSendFn;
  /** テナントに tenant_notification_settings の行が1つも無い場合だけ使う webhook URL フォールバック(環境変数 WEBHOOK_URL)。buildTenantChannels のみで使う */
  webhookUrlFallback?: string;
  /** webhookUrl・smtpPassword の復号に使う。省略/null の場合、暗号化済みの値は復号できず該当チャネルを無効化する */
  encryptor?: Encryptor | null;
}

/** buildPersonalChannels のオプション(webhookUrlFallback は個人チャネルには存在しないため持たない)。 */
export type BuildPersonalChannelsOptions = Omit<BuildNotificationChannelsOptions, "webhookUrlFallback">;

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

/**
 * テナント共有チャネル(webhook)+ テナント SMTP を組み立てる。**管理者向けの集約通知専用**。
 * 本人宛の通知には絶対に使わないこと(buildPersonalChannels を使う)。
 */
export async function buildTenantChannels(
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

/**
 * 本人宛のチャネルを組み立てる。個人設定(user_notification_settings)で
 * `notificationType` の属するカテゴリが有効なチャネルだけを返す:
 *
 * - email: テナントの SMTP 接続情報(接続先)+ 個人の宛先メールアドレス(宛先)。
 *   宛先は NotificationMessage.to.email ではなく、ここで解決した個人アドレスに固定する
 *   (呼び出し元が渡す msg.to.email を上書きする — 呼び出し元は複数チャネルへ同じ
 *   NotificationMessage を dispatch するだけでよく、個人アドレスの解決をここに閉じ込める)。
 * - webhook: **個人の Webhook URL のみ**。テナント共有 Webhook は絶対に使わない。
 *
 * アプリ内通知(notifications テーブルへの作成)はこの関数の対象外
 * (呼び出し元が createNotificationIfAbsent で常に作成する — 既定でアプリ内は常時ON)。
 */
export async function buildPersonalChannels(
  db: Database,
  params: { tenantId: string; userId: string; notificationType: string },
  options: BuildPersonalChannelsOptions = {},
): Promise<NotificationChannel[]> {
  const { tenantId, userId, notificationType } = params;
  const category = resolveNotificationCategory(notificationType);

  const [prefsRow, tenantSettings, user] = await Promise.all([
    getUserNotificationSettings(db, { tenantId, userId }),
    getNotificationSettings(db, tenantId),
    getUserById(db, { tenantId, id: userId }),
  ]);

  // 呼び出し元(reminders/overtime-alerts/leave-alerts の各スキャン)は is_active な
  // ユーザーのみを渡す前提だが、削除・データ不整合等で見つからない場合は防御的に空を返す
  // (通知先が無いだけで、スキャン全体を落とす理由にはしない)。
  if (!user) return [];

  const prefs = resolveUserNotificationPrefs(prefsRow);
  const categoryPrefs = prefs[category];
  const channels: NotificationChannel[] = [];

  if (
    categoryPrefs.email &&
    tenantSettings?.smtpEnabled &&
    tenantSettings.smtpHost &&
    tenantSettings.smtpPort &&
    tenantSettings.smtpFrom &&
    options.smtpSendFn
  ) {
    let smtpPasswordUnavailable = false;
    let password: string | undefined;
    if (tenantSettings.smtpPassword) {
      const decrypted = await decryptSecret(options.encryptor, tenantSettings.smtpPassword);
      if (decrypted === null) {
        smtpPasswordUnavailable = true;
        console.warn(
          `[notification-channels] tenant ${tenantId}: smtpPassword could not be decrypted; disabling the personal email channel for user ${userId}`,
        );
      } else {
        password = decrypted;
      }
    }

    if (!smtpPasswordUnavailable) {
      const emailAddress = resolveEmailAddress(prefsRow, user.email);
      const smtp = createSmtpChannel(
        {
          host: tenantSettings.smtpHost,
          port: tenantSettings.smtpPort,
          from: tenantSettings.smtpFrom,
          ...(tenantSettings.smtpUser ? { user: tenantSettings.smtpUser } : {}),
          ...(password ? { password } : {}),
        },
        options.smtpSendFn,
      );
      // 宛先を個人の解決済みアドレスに固定する(呼び出し元が渡す msg.to.email は無視する)。
      channels.push({
        name: smtp.name,
        send: (msg) => smtp.send({ ...msg, to: { email: emailAddress } }),
      });
    }
  }

  if (categoryPrefs.webhook && prefsRow?.webhookUrl) {
    const url = await decryptSecret(options.encryptor, prefsRow.webhookUrl);
    if (url) {
      channels.push(webhookChannel(url, options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}));
    } else {
      console.warn(
        `[notification-channels] user ${userId}: personal webhookUrl could not be decrypted (missing/rotated key or corrupted value); disabling the webhook channel`,
      );
    }
  }

  return channels;
}
