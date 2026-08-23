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
 *
 * `correction_alert`(2026-08-23 追加): 修正系申請(休憩自動控除の打ち消し等)の承認・却下
 * 通知。migration 0015 で専用列(correction_alert_email/webhook)が入り、他の3カテゴリと
 * 同様に個人設定で ON/OFF できる。
 *
 * `approval_request`(2026-08-23 追加): 承認権限を持つ人向けの「承認依頼が届いた」通知
 * (打刻修正・休暇・休憩自動控除打ち消しの各申請の作成時)。他の3カテゴリは「申請者本人」が
 * 受け手だが、このカテゴリだけは「承認者」が受け手という違いがある(apps/api/src/lib/approvers.ts
 * で解決した承認者一覧に対して個人チャネルを組み立てる際にこのカテゴリを使う)。migration 0019
 * で専用列(approval_request_email/webhook)が入り、他のカテゴリと同様に個人設定で ON/OFF できる。
 */
export const NOTIFICATION_CATEGORIES = [
  "missing_clock_out",
  "overtime_alert",
  "leave_alert",
  "correction_alert",
  "approval_request",
] as const;
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
    correction_alert: Object.freeze({ email: false, webhook: false }),
    approval_request: Object.freeze({ email: false, webhook: false }),
  });

/**
 * notifications.type(例: "missing_clock_out" / "overtime_45h_reached" /
 * "leave_expiring_60d" / "leave_mandatory5_90d" / "leave_request_approved" /
 * "auto_break_waiver_approved" / "correction_request_approved")からカテゴリを解決する。
 * 未知の type は呼び出し元の実装ミスとして扱い、例外を投げる(silent に握りつぶすと
 * 個人設定が効かないまま通知が飛ぶ/飛ばない事故に気づけないため)。
 *
 * 判断点(2026-08-23): 休暇申請の承認・却下通知("leave_request_*")は既存の "leave_"
 * プレフィックス一致にそのまま乗り、leave_alert カテゴリ(失効間近・年5日義務と同じ
 * 「休暇のお知らせ」)に束ねる。打刻修正申請の承認・却下通知("correction_request_*")は
 * auto_break_waiver と同じ correction_alert カテゴリに束ねる(routes/corrections.ts・
 * routes/leave.ts のヘッダコメント参照)。
 *
 * 判断点(2026-08-23 追加): 承認依頼通知("approval_request_*"。routes/corrections.ts・
 * routes/leave.ts・routes/auto-break-waivers.ts の各 POST / 作成時に承認者へ送る)は
 * "leave_" 判定より前に置く必要がある — "approval_request_leave" は "leave_" では
 * 始まらないため実害は無いが、"correction_request_" 系との取り違えを避けるため専用の
 * プレフィックスとして最初に判定する。
 */
export function resolveNotificationCategory(notificationType: string): NotificationCategory {
  if (notificationType === "missing_clock_out") return "missing_clock_out";
  if (notificationType.startsWith("approval_request_")) return "approval_request";
  if (notificationType.startsWith("overtime_")) return "overtime_alert";
  if (notificationType.startsWith("leave_")) return "leave_alert";
  if (notificationType.startsWith("auto_break_waiver_") || notificationType.startsWith("correction_request_")) {
    return "correction_alert";
  }
  throw new Error(`resolveNotificationCategory: unknown notification type "${notificationType}"`);
}

/**
 * DB行(未設定なら null)からカテゴリ別 prefs を解決する。行が無ければ既定値をそのまま返す。
 */
export function resolveUserNotificationPrefs(
  row: UserNotificationSettings | null,
): Record<NotificationCategory, CategoryChannelPrefs> {
  if (!row) {
    return {
      missing_clock_out: { ...DEFAULT_USER_NOTIFICATION_PREFS.missing_clock_out },
      overtime_alert: { ...DEFAULT_USER_NOTIFICATION_PREFS.overtime_alert },
      leave_alert: { ...DEFAULT_USER_NOTIFICATION_PREFS.leave_alert },
      correction_alert: { ...DEFAULT_USER_NOTIFICATION_PREFS.correction_alert },
      approval_request: { ...DEFAULT_USER_NOTIFICATION_PREFS.approval_request },
    };
  }
  return {
    missing_clock_out: { email: row.missingClockOutEmail, webhook: row.missingClockOutWebhook },
    overtime_alert: { email: row.overtimeAlertEmail, webhook: row.overtimeAlertWebhook },
    leave_alert: { email: row.leaveAlertEmail, webhook: row.leaveAlertWebhook },
    correction_alert: { email: row.correctionAlertEmail, webhook: row.correctionAlertWebhook },
    approval_request: { email: row.approvalRequestEmail, webhook: row.approvalRequestWebhook },
  };
}

/** 通知先メールアドレスを解決する。個人設定の emailAddress が無ければアカウントの email を使う。 */
export function resolveEmailAddress(row: UserNotificationSettings | null, accountEmail: string): string {
  return row?.emailAddress ?? accountEmail;
}
