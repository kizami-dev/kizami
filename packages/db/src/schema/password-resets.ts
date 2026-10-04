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
 * 本人用の「パスワードを忘れた」(2026-10-04 追加)は、システムメール(SYSTEM_SMTP_URL ほか)が
 * ある配備でだけ有効にする。無い配備(セルフホスト)では従来どおり管理者発行+リンク手渡しだけで
 * 回り、SMTP 無しでも成り立つ。本人発行のトークンも同じ表・同じ使用フローを流用し、
 * `source` 列(`admin` / `self`)で発行経路を区別する(下記)。
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
    /**
     * 発行経路。`admin` = 管理者が発行(既定。既存の行はすべてこれ)、`self` = 本人が「パスワードを
     * 忘れた」から発行(created_by は本人の user_id)。
     *
     * created_by == user_id で代用しなかった理由: 管理者が自分自身へ発行した場合も同じ形になり、
     * 本人発行の再発行(古いトークンの失効)が管理者発行のトークンまで巻き込んでしまうため。
     * 列挙型(CHECK 制約)にはしていない — 値の検証は書き込み側(queries/password-resets.ts)が担う。
     */
    source: text("source").notNull().default("admin"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("password_reset_tokens_hash_idx").on(table.tokenHash),
    index("password_reset_tokens_tenant_user_idx").on(table.tenantId, table.userId),
  ],
);

/**
 * password_reset_requests — 本人用パスワード再設定の**メール単位スロットル**(システム表)。
 *
 * 「メールアドレスごとに5分に1回しか再設定メールを出さない」を、同時リクエストでも破れない形で
 * 担保するための表(判断の背景は queries/password-resets.ts の
 * `acquirePasswordResetRequestSlot`)。tenant_id を持たない(同じメールが複数テナントに居ても
 * 1通のメールにまとめて出すため、メール単位で数える)。pending_signups と同じ「システム表」で、
 * テナント向けのクエリからは触らない。
 *
 * 行はメールが実在するかに関係なく作る(応答時間を該当者の有無から独立させるため、スロットルの取得は
 * 対象の探索より前・応答の前に全メール共通で行う)。放置すると要求されたメールの種類数だけ増えるので、
 * 定期ジョブ(signup-cleanup.ts)が窓を過ぎた行を消す。
 */
export const passwordResetRequests = sqliteTable("password_reset_requests", {
  /** 照合キー(trim + 小文字化したメール)。主キー = ON CONFLICT の対象 */
  emailKey: text("email_key").primaryKey(),
  /** UTC エポック分。直近にメールを出した時刻 */
  requestedAt: integer("requested_at").notNull(),
});
