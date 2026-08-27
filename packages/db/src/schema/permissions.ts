/**
 * permission_presets: 名前+説明+grants(業務タスク権限キー×スコープの配列, JSON)
 * +denies(拒否する権限キーの配列, JSON。スコープなし・全面的)。
 * 同梱プリセットは `is_system` フラグで編集不可。
 * preset_assignments: user × preset(複数可・合算)。実効権限はメモリ上で展開しキャッシュ。
 *
 * 権限カタログの具体項目: docs/design/permission-catalog.md
 * 参照: docs/design/v01-data-model.md §組織・認証・権限
 */

import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { tenants } from "./tenants.js";
import { users } from "./users.js";

export const permissionPresets = sqliteTable("permission_presets", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id")
    .notNull()
    .references(() => tenants.id),
  name: text("name").notNull(),
  description: text("description"),
  /** { key: string; scope: string }[] の JSON 文字列(permission-catalog.md のキー) */
  grants: text("grants").notNull(),
  /**
   * 拒否ルール(deny、2026-08-24 追加)。`string[]`(権限キーの配列)の JSON 文字列。
   *
   * 判断点(なぜ grants 用の別テーブル + kind 列にしなかったか): このスキーマには
   * そもそも「grants テーブル」が無く、付与は permission_presets 行の JSON 列1本で
   * 表現されている。deny だけを別テーブルに切ると、同じ概念(プリセットが持つ権限)の
   * 保存形式が2種類に割れるうえ、実効権限を読む全経路(queries/permissions.ts の
   * listAssignedPresetGrants / listTenantPresetGrantsByUser)に JOIN が1本増える。
   * deny はスコープを持たない単なるキー列(schema 的には grants より単純)なので、
   * grants と同じ「同一行の JSON 列」で持つのが既存スキーマに最も素直に収まる。
   * プリセット更新が1行の UPDATE で原子的に済む(grants と denies がズレない)利点もある。
   */
  denies: text("denies").notNull().default("[]"),
  /** true = 同梱プリセット(編集不可) */
  isSystem: integer("is_system", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at").notNull(),
});

export const presetAssignments = sqliteTable(
  "preset_assignments",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    presetId: text("preset_id")
      .notNull()
      .references(() => permissionPresets.id),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    index("preset_assignments_tenant_user_idx").on(table.tenantId, table.userId),
    uniqueIndex("preset_assignments_user_preset_idx").on(table.userId, table.presetId),
  ],
);
