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
