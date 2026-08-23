/**
 * users / auth_credentials / sessions — 自前認証(email + パスワード)。
 * パスワードは argon2id でハッシュ化して `auth_credentials.password_hash` に保存する。
 * OIDC 用の外部 ID テーブルは v1.0 で追加(v0.1 スコープ外)。
 *
 * 参照: docs/design/v01-data-model.md §組織・認証・権限
 */

import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { tenants } from "./tenants.js";

export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id),
    email: text("email").notNull(),
    name: text("name").notNull(),
    /** false = 無効化(退職処理済み)。ログイン不可 */
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    /** 入社日。ローカル日付 "YYYY-MM-DD"。法定有給付与の計算に使う。null = 未設定(有給自動付与不可) */
    hireDate: text("hire_date"),
    /**
     * 年次有給休暇の付与区分(2026-08-24 追加、労基法39条3項・労基法施行規則24条の3)。
     * "full"(通常=週5日以上)| "days4" | "days3" | "days2" | "days1"(比例付与)。
     *
     * 判断点: 週所定労働日数・週所定労働時間を保存して導出するのではなく、**就業規則ベースの
     * 区分そのもの**を明示的に持つ。比例付与の要件は「週所定労働時間30時間未満」かつ
     * 「週所定労働日数4日以下」という連言で、これは雇用契約を結んだ管理者が既に知っている
     * 事実である一方、KIZAMI 側には週所定を表すデータが無い(シフト制では実績が週ごとに
     * 変動し、実績から推定すると閑散期に区分が下がる)。黙って導出して外すと**法定より
     * 少ない日数しか付与しない**方向の事故=労基法39条違反になるため、導出はしない。
     * 既定は最も日数の多い "full"。
     */
    leaveGrantClass: text("leave_grant_class").notNull().default("full"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [uniqueIndex("users_tenant_email_idx").on(table.tenantId, table.email)],
);

/** 認証情報。v0.1 は user 1件につき1行(email+パスワードのみ) */
export const authCredentials = sqliteTable(
  "auth_credentials",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    /** argon2id ハッシュ */
    passwordHash: text("password_hash").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [uniqueIndex("auth_credentials_user_idx").on(table.userId)],
);

export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    createdAt: integer("created_at").notNull(),
    expiresAt: integer("expires_at").notNull(),
    /** null = 有効。手動失効(ログアウト等)の記録 */
    revokedAt: integer("revoked_at"),
  },
  (table) => [index("sessions_tenant_user_idx").on(table.tenantId, table.userId)],
);
