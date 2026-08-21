/**
 * tenant_notification_settings — テナント単位の通知チャネル設定(1テナント1行、可変)。
 *
 * 対応権限: `notification.settings.manage`(scope tenant のみ。docs/design/permission-catalog.md §1.11)。
 * `tenant_setting_versions`(packages/db/src/schema/settings.ts)と異なり、通知チャネル設定は
 * effective-dated な労務計算入力ではなく単なる運用設定のため、版管理せず直接 UPDATE する
 * (GET/PUT /settings/notifications — apps/api/src/routes/settings.ts)。
 *
 * 秘密情報(`webhook_url` / `smtp_password`)は API 層でマスクして返す。DB 層はそのまま平文で
 * 保持する(暗号化は将来検討、v0.2 スコープ外)。
 */

import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { tenants } from "./tenants.js";
import { users } from "./users.js";

export const tenantNotificationSettings = sqliteTable("tenant_notification_settings", {
  tenantId: text("tenant_id")
    .primaryKey()
    .references(() => tenants.id),
  webhookEnabled: integer("webhook_enabled", { mode: "boolean" }).notNull().default(false),
  /** Slack/Discord互換 Webhook の URL。webhookEnabled=false でも値自体は保持してよい(再有効化時の利便性) */
  webhookUrl: text("webhook_url"),
  smtpEnabled: integer("smtp_enabled", { mode: "boolean" }).notNull().default(false),
  smtpHost: text("smtp_host"),
  smtpPort: integer("smtp_port"),
  smtpUser: text("smtp_user"),
  smtpPassword: text("smtp_password"),
  smtpFrom: text("smtp_from"),
  /** UTC エポック分 */
  updatedAt: integer("updated_at").notNull(),
  updatedBy: text("updated_by")
    .notNull()
    .references(() => users.id),
});
