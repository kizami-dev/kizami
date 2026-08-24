/**
 * user_notification_settings — 個人単位の通知受け取り設定(1ユーザー1行、可変)。
 *
 * 参照: docs/requirements.md §7「通知設定の2層構造」。
 * `tenant_notification_settings`(チャネルの接続情報 = 会社が決める)とは明確に分離する。
 * こちらは「通知の種類ごとにどのチャネルで受け取るか」という**従業員本人**の希望であり、
 * 他人には見えない個人情報として扱う(API 層は本人のみ読み書き可能にする — 権限チェック無し
 * で認証済み本人の tenant_id/user_id に固定する)。
 *
 * 通知種別の粒度(判断点、完了報告に明記): notifications テーブルの `type` は
 * missing_clock_out / overtime_* (8種) / leave_expiring_*d (3種) / leave_mandatory5_*d (2種) の
 * 計14種類あるが、種類ごとに個別カラムを持つと今後 type が増えるたびにスキーマ変更が必要になり
 * 過剰に細かい。実際に従業員が意識する単位は「打刻忘れ」「時間外(36協定)アラート」
 * 「休暇アラート」の3カテゴリで十分と判断し、type→カテゴリの対応表
 * (apps/api/src/lib/notification-preferences.ts に一元管理)でまとめる。
 *
 * チャネル: アプリ内(常時ON・カラムなし=変更不可)、メール、個人 Webhook、
 * ブラウザプッシュ(Web Push、2026-08-24 追加 — `*_push` 列)。
 * - email_address: null ならテナントの users.email を使う(API 層で解決)
 * - webhook_url: 個人の Webhook URL。tenant_notification_settings と同様に暗号化して保存する
 *   (apps/api/src/lib/encryption.ts、"enc:v1:" プレフィクス)
 * - `*_push`(docs/design/web-push.md): `*_email` と完全に同じ粒度・同じ既定値(false)。
 *   宛先(どのブラウザへ送るか)はこのテーブルではなく push_subscriptions テーブルが持つ
 *   (1ユーザーが複数ブラウザを購読しうるため)。VAPID 鍵が未設定の配備では API が
 *   pushAvailable=false を返し UI からこの列が消えるが、列の値自体はそのまま保持する
 *   (鍵を設定し直せば以前の希望がそのまま復活する)
 *
 * 既定値(行が無い場合): アプリ内=ON・メール=OFF・Webhook=未設定。この既定値もコードの
 * 1箇所(apps/api/src/lib/notification-preferences.ts の DEFAULT_USER_NOTIFICATION_PREFS)に
 * まとめ、API・UI・スキャンが同じ値を見るようにする(行が無い = 既定値を使う、で表現する)。
 */

import { integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { tenants } from "./tenants.js";
import { users } from "./users.js";

export const userNotificationSettings = sqliteTable(
  "user_notification_settings",
  {
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),

    /** 打刻忘れ(missing_clock_out) */
    missingClockOutEmail: integer("missing_clock_out_email", { mode: "boolean" }).notNull().default(false),
    missingClockOutWebhook: integer("missing_clock_out_webhook", { mode: "boolean" }).notNull().default(false),
    missingClockOutPush: integer("missing_clock_out_push", { mode: "boolean" }).notNull().default(false),

    /** 36協定・時間外アラート(overtime_*、8種) */
    overtimeAlertEmail: integer("overtime_alert_email", { mode: "boolean" }).notNull().default(false),
    overtimeAlertWebhook: integer("overtime_alert_webhook", { mode: "boolean" }).notNull().default(false),
    overtimeAlertPush: integer("overtime_alert_push", { mode: "boolean" }).notNull().default(false),

    /** 有給の失効間近・年5日取得義務アラート(leave_*、5種) */
    leaveAlertEmail: integer("leave_alert_email", { mode: "boolean" }).notNull().default(false),
    leaveAlertWebhook: integer("leave_alert_webhook", { mode: "boolean" }).notNull().default(false),
    leaveAlertPush: integer("leave_alert_push", { mode: "boolean" }).notNull().default(false),

    /** 修正系申請の承認・却下通知(correction_* / auto_break_waiver_*。2026-08-23 追加) */
    correctionAlertEmail: integer("correction_alert_email", { mode: "boolean" }).notNull().default(false),
    correctionAlertWebhook: integer("correction_alert_webhook", { mode: "boolean" }).notNull().default(false),
    correctionAlertPush: integer("correction_alert_push", { mode: "boolean" }).notNull().default(false),

    /** 承認依頼(スコープ内で申請が作成されたことを承認権限保持者へ。2026-08-23 Tier0 追加) */
    approvalRequestEmail: integer("approval_request_email", { mode: "boolean" }).notNull().default(false),
    approvalRequestWebhook: integer("approval_request_webhook", { mode: "boolean" }).notNull().default(false),
    approvalRequestPush: integer("approval_request_push", { mode: "boolean" }).notNull().default(false),

    /** シフトとの乖離(前日の自分の勤務がシフトとずれたことを本人へ。2026-08-24 追加) */
    shiftVarianceEmail: integer("shift_variance_email", { mode: "boolean" }).notNull().default(false),
    shiftVarianceWebhook: integer("shift_variance_webhook", { mode: "boolean" }).notNull().default(false),
    shiftVariancePush: integer("shift_variance_push", { mode: "boolean" }).notNull().default(false),

    /** null なら users.email を使う(API 層で解決) */
    emailAddress: text("email_address"),
    /** 個人の Webhook URL。暗号化して保存(apps/api/src/lib/encryption.ts) */
    webhookUrl: text("webhook_url"),

    /** UTC エポック分 */
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.tenantId, table.userId] })],
);
