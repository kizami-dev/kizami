/**
 * password_reset_tokens — 管理者発行のパスワードリセット(2026-08-23、Tier 0)。
 *
 * 自前認証にリセット経路が無く「パスワードを忘れた従業員を管理者でも救えない」穴を塞ぐ。
 * 招待(invitations)と同じ作法: 平文トークンは発行時に1度だけ表示し、DB には SHA-256 のみ。
 * 招待との違い:
 * - 対象は**受諾済み(auth_credentials がある)ユーザー**。未受諾者は招待の再発行が正
 * - 有効期限は短い(24時間。招待は7日 — リセットは「今困っている人」への即時対応であり、
 *   長寿命リンクが漂流する利益がない)
 * - 使用(used_at)で auth_credentials を UPDATE し、**当該ユーザーの全セッションを失効**させる
 *   (パスワードを変えた=旧資格情報の疑いがあるため。apps/api 側の責務)
 *
 * self-serve の forgot-password(メール送信)は SMTP 設定が前提になるため今回は作らない。
 * 管理者発行+リンク手渡しは招待と同じ運用で SMTP 無しでも回る。
 *
 * 追記専用。再発行は既存の未使用トークンを revoke してから新規作成(invitations と同じ不変条件:
 * 未決着はユーザーごとに高々1本。アプリ層のトランザクションで担保)。
 */

import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { tenants } from "./tenants.js";
import { users } from "./users.js";

export const passwordResetTokens = sqliteTable(
  "password_reset_tokens",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    /** トークンの SHA-256(hex)。平文は保存しない */
    tokenHash: text("token_hash").notNull(),
    /** UTC エポック分 */
    expiresAt: integer("expires_at").notNull(),
    /** null = 未使用 */
    usedAt: integer("used_at"),
    /** null = 有効(再発行・取り消しで設定) */
    revokedAt: integer("revoked_at"),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("password_reset_tokens_hash_idx").on(table.tokenHash),
    index("password_reset_tokens_tenant_user_idx").on(table.tenantId, table.userId),
  ],
);
