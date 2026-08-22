/**
 * Slack スラッシュコマンド打刻(docs/external-api/slack.md)用のテーブル群。
 *
 * - `tenant_slack_settings`: テナント単位のSlack連携設定(1テナント1行)。Signing Secret は
 *   他の秘密情報(tenant_notification_settings.webhookUrl 等)と同じ "enc:v1:..." 形式で
 *   暗号化して保存する(apps/api/src/lib/encryption.ts)。DB 層は暗号文/平文を区別しない。
 * - `team_id`(Slack ワークスペースID)は「1テナント=1ワークスペース」の前提
 *   (依頼どおり、複数テナントが同じワークスペースを使うことは想定しない)で UNIQUE にする。
 *   POST /slack/commands はこのカラムから逆引きしてテナントを特定する。
 * - `slack_user_links`: Slackユーザーとkizamiユーザーの明示連携(ワンタイムトークン経由)。
 *   1人のkizamiユーザーが複数のSlackアカウントを紐付けないよう UNIQUE(tenant_id, user_id) も張る。
 * - `slack_link_tokens`: `/punch link` が発行するワンタイムトークン。api_keys と同じ方式
 *   (クライアントには平文のみ渡し、DBにはSHA-256(hex)のみ保存する)。短命(15分)。
 */

import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { tenants } from "./tenants.js";
import { users } from "./users.js";

export const tenantSlackSettings = sqliteTable(
  "tenant_slack_settings",
  {
    tenantId: text("tenant_id")
      .primaryKey()
      .references(() => tenants.id),
    /** Slack ワークスペースID(例 "T0123456")。1テナント=1ワークスペース前提でUNIQUE。未設定はnull */
    teamId: text("team_id"),
    /** Signing Secret。"enc:v1:..." で暗号化して保存(apps/api/src/lib/encryption.ts)。未設定はnull */
    signingSecret: text("signing_secret"),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(false),
    /** UTC エポック分 */
    updatedAt: integer("updated_at").notNull(),
    updatedBy: text("updated_by")
      .notNull()
      .references(() => users.id),
  },
  (table) => [uniqueIndex("tenant_slack_settings_team_id_idx").on(table.teamId)],
);

/** Slackユーザー(slack_user_id)とkizamiユーザーの明示連携。 */
export const slackUserLinks = sqliteTable(
  "slack_user_links",
  {
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id),
    /** Slack側のユーザーID(例 "U012ABCDEF")。kizami内部のuser_idとは無関係の外部ID */
    slackUserId: text("slack_user_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    /** UTC エポック分 */
    linkedAt: integer("linked_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.tenantId, table.slackUserId] }),
    uniqueIndex("slack_user_links_tenant_user_idx").on(table.tenantId, table.userId),
  ],
);

/**
 * `/punch link` が発行するワンタイムトークン。api_keys(schema/api-keys.ts)と同じ方式:
 * 平文トークンはSlackへのephemeral応答としてのみ表示し、DBにはSHA-256(hex)のみ保存する。
 * 短命(15分、apps/api/src/routes/slack.ts の LINK_TOKEN_TTL_MINUTES)。
 */
export const slackLinkTokens = sqliteTable(
  "slack_link_tokens",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id),
    slackUserId: text("slack_user_id").notNull(),
    /** トークンの SHA-256(hex)。平文トークンはDBに保存しない */
    tokenHash: text("token_hash").notNull(),
    /** UTC エポック分 */
    expiresAt: integer("expires_at").notNull(),
    /** UTC エポック分。null = 未使用 */
    usedAt: integer("used_at"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("slack_link_tokens_token_hash_idx").on(table.tokenHash),
    index("slack_link_tokens_tenant_slack_user_idx").on(table.tenantId, table.slackUserId),
  ],
);
