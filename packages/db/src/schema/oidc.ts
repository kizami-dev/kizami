/**
 * OIDC(SSO ログイン)のテナント単位設定。docs/design/sso-oidc.md が仕様の正。
 *
 * - `tenant_oidc_settings`: 1テナント1行(tenant_slack_settings / tenant_notification_settings と
 *   同じ形)。client_secret は他の秘密情報と同じ "enc:v1:..." 形式で暗号化して保存する
 *   (apps/api/src/lib/encryption.ts)。DB 層は暗号文/平文を区別しない。
 * - **自動プロビジョニングは行わない**ため、IdP 側のユーザーIDを保持するテーブル
 *   (よくある `oidc_identities` のような外部IDの対応表)は持たない。ログイン時の突合は
 *   「IdP が返したメールアドレス == users.email(同一テナント内)」だけで行う
 *   (KIZAMI は招待式のみ・要件 §7)。外部IDを持たない判断の理由は docs/design/sso-oidc.md 参照。
 * - `allow_unverified_email` は既定 false。IdP が `email_verified: false` を返す場合でも
 *   ログインを許すかのテナント単位のスイッチで、**危険側の設定**(未検証メールを信じると
 *   「他人のメールアドレスを自称できる IdP」でのなりすましが成立しうる)。
 *   自前 IdP 等で email_verified を出さない構成のための逃げ道として用意する。
 */

import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { tenants } from "./tenants.js";
import { users } from "./users.js";

export const tenantOidcSettings = sqliteTable("tenant_oidc_settings", {
  tenantId: text("tenant_id")
    .primaryKey()
    .references(() => tenants.id),
  /** IdP の issuer URL(例 "https://accounts.google.com")。ディスカバリは {issuer}/.well-known/openid-configuration。未設定は null */
  issuer: text("issuer"),
  /** IdP に登録したクライアントID。秘密情報ではないため平文で保存する。未設定は null */
  clientId: text("client_id"),
  /** クライアントシークレット。"enc:v1:..." で暗号化して保存する。未設定は null */
  clientSecret: text("client_secret"),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(false),
  /** email_verified が false(または欠落)の ID トークンでもログインを許すか。既定 false(安全側) */
  allowUnverifiedEmail: integer("allow_unverified_email", { mode: "boolean" }).notNull().default(false),
  /** UTC エポック分 */
  updatedAt: integer("updated_at").notNull(),
  updatedBy: text("updated_by")
    .notNull()
    .references(() => users.id),
});
