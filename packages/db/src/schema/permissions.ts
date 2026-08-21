/**
 * permission_presets: 名前+説明+grants(業務タスク権限キー×スコープの配列, JSON)。
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
