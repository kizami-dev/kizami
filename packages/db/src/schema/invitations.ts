/**
 * invitations — メンバー招待式登録(docs/requirements.md §認証、2026-08-23 決定)。
 *
 * 管理者がメンバーを作成した時点で users 行はできるが、auth_credentials はまだ無い
 * (「招待中」状態、ログイン不可)。従業員が招待リンクからパスワードを設定して初めて
 * auth_credentials が作られる(queries/invitations.ts の acceptInvitation)。
 *
 * トークンは sessions(schema/users.ts)・api_keys(schema/api-keys.ts)と同じ方式:
 * クライアントには32バイト乱数の URLセーフ base64 のみを渡し、DB には SHA-256(hex)のみ
 * 保存する(`token_hash`, UNIQUE)。DB が読み出されても有効なトークンを復元できない。
 *
 * 判断点(部分UNIQUEを使わない理由): 「同一 user への有効な招待(未受諾・未失効・期限内)は
 * 概念上1件」だが、有効性の判定に expires_at という値(現在時刻との比較)が絡むため、
 * SQLite の部分 UNIQUE index(常に決定的な式のみが条件にできる)では表現できない。
 * 代わりに auto_break_waivers 等と同じ「追記型」の流儀を踏襲し、一意性の保証はアプリ層
 * (queries/invitations.ts の createInvitation — 発行時に既存の未決着招待を revoke してから
 * 新規作成する)に委ねる。
 */

import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { tenants } from "./tenants.js";
import { users } from "./users.js";

export const invitations = sqliteTable(
  "invitations",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id),
    /** 招待対象。管理者が作成した「招待中」の users 行 */
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    /** トークンの SHA-256(hex)。平文トークンは発行時のみクライアントへ返し、DB には保存しない */
    tokenHash: text("token_hash").notNull(),
    /** UTC エポック分。発行から7日後(固定、apps/api/src/auth/invitation-token.ts） */
    expiresAt: integer("expires_at").notNull(),
    /** UTC エポック分。null = 未受諾 */
    acceptedAt: integer("accepted_at"),
    /** UTC エポック分。null = 有効。再発行・取り消しで立てる(行は消さない、監査のため) */
    revokedAt: integer("revoked_at"),
    /** 発行した管理者 */
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("invitations_token_hash_idx").on(table.tokenHash),
    index("invitations_tenant_user_idx").on(table.tenantId, table.userId),
  ],
);
