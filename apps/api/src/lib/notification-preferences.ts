/**
 * 個人の通知受け取り設定(user_notification_settings)まわりの単一ソース定義。
 *
 * 参照: docs/requirements.md §7「通知設定の2層構造」。
 *
 * このファイルが「1箇所」として持つもの(依頼の「既定値はコードの1箇所に定義」への回答):
 * - 通知カテゴリの一覧と、notifications.type → カテゴリの対応表(resolveNotificationCategory)
 * - 行が無い(=未設定)場合の既定値(DEFAULT_USER_NOTIFICATION_PREFS: アプリ内=常時ON・
 *   メール=OFF・個人Webhook=未設定)
 * - DB行 → カテゴリ別 prefs への変換(resolveUserNotificationPrefs)
 * - 通知先メールアドレスの解決(resolveEmailAddress: 個人設定が無ければ users.email)
 *
 * apps/api/src/lib/notification-channels.ts(buildPersonalChannels)と
 * apps/api/src/routes/notification-preferences.ts(GET/PUT /settings/notifications/me)の
 * 両方がこのファイルの定義だけを見る。Web UI 側は独自の既定値を持たず、GET のレスポンスを
 * そのまま表示することで同じ既定値を間接的に共有する(apps/web は @kizami/db に依存しないため)。
 */

import type { UserNotificationSettings } from "@kizami/db";

/**
 * 通知カテゴリ(判断点、完了報告に明記): notifications.type は14種類あるが
 * (missing_clock_out / overtime_* 8種 / leave_expiring_*d 3種 / leave_mandatory5_*d 2種)、
 * 従業員が実際に意識する単位はこの3カテゴリで十分と判断し束ねた。type が将来増えても
 * このカテゴリ数は増やさず、resolveNotificationCategory の対応表だけを拡張する想定。
 */
export const NOTIFICATION_CATEGORIES = ["missing_clock_out", "overtime_alert", "leave_alert"] as const;
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

export interface CategoryChannelPrefs {
  email: boolean;
  webhook: boolean;
}

/** 既定値: アプリ内は常時ON(この定数には含めない=不変)、メールはOFF、個人Webhookは未設定。 */
export const DEFAULT_USER_NOTIFICATION_PREFS: Readonly<Record<NotificationCategory, Readonly<CategoryChannelPrefs>>> =
  Object.freeze({
    missing_clock_out: Object.freeze({ email: false, webhook: false }),
    overtime_alert: Object.freeze({ email: false, webhook: false }),
    leave_alert: Object.freeze({ email: false, webhook: false }),
  });

/**
 * notifications.type(例: "missing_clock_out" / "overtime_45h_reached" /
 * "leave_expiring_60d" / "leave_mandatory5_90d")からカテゴリを解決する。
 * 未知の type は呼び出し元の実装ミスとして扱い、例外を投げる(silent に握りつぶすと
 * 個人設定が効かないまま通知が飛ぶ/飛ばない事故に気づけないため)。
 */
export function resolveNotificationCategory(notificationType: string): NotificationCategory {
  if (notificationType === "missing_clock_out") return "missing_clock_out";
  if (notificationType.startsWith("overtime_")) return "overtime_alert";
  if (notificationType.startsWith("leave_")) return "leave_alert";
  throw new Error(`resolveNotificationCategory: unknown notification type "${notificationType}"`);
}

/** DB行(未設定なら null)からカテゴリ別 prefs を解決する。行が無ければ既定値をそのまま返す。 */
export function resolveUserNotificationPrefs(
  row: UserNotificationSettings | null,
): Record<NotificationCategory, CategoryChannelPrefs> {
  if (!row) {
    return {
      missing_clock_out: { ...DEFAULT_USER_NOTIFICATION_PREFS.missing_clock_out },
      overtime_alert: { ...DEFAULT_USER_NOTIFICATION_PREFS.overtime_alert },
      leave_alert: { ...DEFAULT_USER_NOTIFICATION_PREFS.leave_alert },
    };
  }
  return {
    missing_clock_out: { email: row.missingClockOutEmail, webhook: row.missingClockOutWebhook },
    overtime_alert: { email: row.overtimeAlertEmail, webhook: row.overtimeAlertWebhook },
    leave_alert: { email: row.leaveAlertEmail, webhook: row.leaveAlertWebhook },
  };
}

/** 通知先メールアドレスを解決する。個人設定の emailAddress が無ければアカウントの email を使う。 */
export function resolveEmailAddress(row: UserNotificationSettings | null, accountEmail: string): string {
  return row?.emailAddress ?? accountEmail;
}
