/**
 * セルフサインアップ(KIZAMI Cloud、docs/design/saas.md「サインアップ」)の**システム表**2つ。
 *
 * - `signup_invite_codes`: Closed Beta の招待コード(SIGNUP_MODE=invite)。運用者 CLI
 *   (`pnpm operator invite-code ...`)が発行・失効する。
 * - `pending_signups`: メール確認待ちの登録申請。確認リンクを踏んだ時点で初めて
 *   テナントを作る(未確認の空テナントを作らない)。
 *
 * ## システム表の例外(docs/design/multi-tenancy.md)
 *
 * どちらも **tenant_id を持たない**。登録の時点ではまだテナントが存在しない(これから作る)ため
 * 持てないし、招待コードは「どのテナントのものでもなく運用者のもの」だから。テナント分離の原則
 * 「テナント所有の表は必ず tenant_id を持ち、クエリは常に tenant_id で絞る」の対象外であり、
 * アプリのテナント向けクエリ(queries/ の他のファイル)からは一切触らない。アクセス経路は
 * routes/signup.ts・運用者 CLI(operator.ts)・掃除ジョブ(signup-cleanup.ts)に限る。
 * `pending_signups.tenant_id` は「確認完了後に作られたテナントの記録」(参照のみ)であって、
 * 行の所有者を表すものではない。
 *
 * ## トークン・コードの保存
 *
 * 招待受諾(schema/invitations.ts)・セッション・API キーと同じ作法: 平文は発行時に1度だけ
 * 相手へ渡し、DB には SHA-256(hex)だけを保存する(DB が読み出されても有効なものを復元できない)。
 */

import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { tenants } from "./tenants.js";

export const signupInviteCodes = sqliteTable(
  "signup_invite_codes",
  {
    id: text("id").primaryKey(),
    /** 招待コードの SHA-256(hex)。平文は発行時に運用者へ1度だけ表示し、DB には保存しない */
    codeHash: text("code_hash").notNull(),
    /** 運用者のメモ(誰に渡したコードか等)。登録者には見えない */
    note: text("note"),
    /** 利用できる最大回数(= 作れるテナント数)。used_count がこれに達すると使えない */
    maxUses: integer("max_uses").notNull().default(1),
    /** 消費済み回数。確認完了(テナント作成)のトランザクション内で条件付き UPDATE により +1 する */
    usedCount: integer("used_count").notNull().default(0),
    /** UTC エポック分。null = 無期限 */
    expiresAt: integer("expires_at"),
    /** UTC エポック分。null = 有効。失効しても行は消さない(使用実績を残すため) */
    revokedAt: integer("revoked_at"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [uniqueIndex("signup_invite_codes_code_hash_idx").on(table.codeHash)],
);

export const pendingSignups = sqliteTable(
  "pending_signups",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    organizationName: text("organization_name").notNull(),
    adminName: text("admin_name").notNull(),
    // パスワード列は**意図的に持たない**。登録時にパスワードを受け取ると、他人のメールアドレスと
    // 自分で決めたパスワードで登録され、本人が確認リンクを踏んだ時点で「攻撃者がパスワードを知る
    // テナント」が本人名義で作られてしまう(アカウント乗っ取り)。パスワードは確認時(リンクを踏んだ
    // 本人が画面で設定)に受け取り、招待受諾(schema/invitations.ts)と同じ作法にしてある。
    /** 確認トークンの SHA-256(hex)。平文は確認メールのリンクにだけ載せる */
    tokenHash: text("token_hash").notNull(),
    /** 登録時に使った招待コード(SIGNUP_MODE=invite のとき)。消費は確認完了時 */
    inviteCodeId: text("invite_code_id").references(() => signupInviteCodes.id),
    /** UTC エポック分。登録から24時間後 */
    expiresAt: integer("expires_at").notNull(),
    /** UTC エポック分。null = 未消費。確認が完了した時刻 */
    consumedAt: integer("consumed_at"),
    /** 確認完了後に作られたテナント。未消費なら null */
    tenantId: text("tenant_id").references(() => tenants.id),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("pending_signups_token_hash_idx").on(table.tokenHash),
    // 同一メールの未消費行を引く(再登録時のトークン発行し直し)・掃除ジョブの期限走査用
    index("pending_signups_email_idx").on(table.email),
    index("pending_signups_expires_at_idx").on(table.expiresAt),
  ],
);
