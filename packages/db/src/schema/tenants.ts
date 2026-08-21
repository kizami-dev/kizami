/**
 * tenants — テナントの不変属性のみ。
 *
 * 計算に影響する設定は持たない(それらは `tenant_setting_versions` の版として管理する)。
 * 参照: docs/design/v01-data-model.md §組織・認証・権限
 */

import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const tenants = sqliteTable("tenants", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  /** UTC エポック分 */
  createdAt: integer("created_at").notNull(),
});
