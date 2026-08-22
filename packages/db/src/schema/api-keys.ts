/**
 * api_keys — 公開打刻API(セッションCookieを持てない外部クライアント向け)の認証キー。
 *
 * セッション(schema/users.ts の `sessions`)と同じ方式: クライアントには乱数トークンの
 * みを渡し、DB には SHA-256(hex)のみ保存する(`key_hash`, UNIQUE)。DB が読み出されても
 * 有効なトークンを復元できない。
 *
 * - キーはユーザーに紐づく(打刻の主体を明確にするため。「誰の代わりに打刻したか」ではなく
 *   「そのユーザーとして打刻する」)
 * - `scopes` は用途を絞るための JSON 配列文字列(例: `["punch"]`)。値の集合・検証は
 *   apps/api 側(apps/api/src/auth/api-key-scopes.ts)の責務とし、DB 層は中身を解釈しない
 *   (`permission_presets.grants` と同じ方針)
 * - `expires_at` は任意(null = 無期限)。失効は行を消さず `revoked_at` を立てる(監査のため)
 * - `last_used_at` は未使用キーを見つけるための最終使用日時。更新頻度の間引き(1時間に1回)は
 *   apps/api 側の判断(apps/api/src/auth/api-key.ts)で行い、DB 層(queries/api-keys.ts の
 *   touchApiKeyLastUsed)は単純な更新のみを提供する
 *
 * 参照: docs/design/permission-catalog.md §1.14(api_key.manage)
 */

import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { tenants } from "./tenants.js";
import { users } from "./users.js";

export const apiKeys = sqliteTable(
  "api_keys",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id),
    /** 打刻の主体(=このキーで認証すると、このユーザーとして扱われる) */
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    /** 用途がわかる名前(必須)。例: "IC card reader (2F entrance)" */
    name: text("name").notNull(),
    /** トークンの SHA-256(hex)。平文トークンは発行時のみクライアントへ返し、DB には保存しない */
    keyHash: text("key_hash").notNull(),
    /** `{ ApiKeyScope }[]` の JSON 配列文字列。例: `["punch"]` */
    scopes: text("scopes").notNull(),
    /** UTC エポック分。null = 無期限 */
    expiresAt: integer("expires_at"),
    /** UTC エポック分。未使用なら null */
    lastUsedAt: integer("last_used_at"),
    /** UTC エポック分。null = 有効。手動失効の記録(行は消さない) */
    revokedAt: integer("revoked_at"),
    /** 発行した(操作した)ユーザー。self発行なら user_id と同じ、api_key.manage 経由の代理発行なら操作者 */
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("api_keys_key_hash_idx").on(table.keyHash),
    index("api_keys_tenant_user_idx").on(table.tenantId, table.userId),
  ],
);
