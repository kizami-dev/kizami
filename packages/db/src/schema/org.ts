/**
 * departments(parent_id による木)+ memberships(user × department × 役職)。
 * v0.1 ではフラット1部署で運用可。
 *
 * 参照: docs/design/v01-data-model.md §組織・認証・権限
 */

import { index, integer, sqliteTable, text, type AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import { tenants } from "./tenants.js";
import { users } from "./users.js";

export const departments = sqliteTable(
  "departments",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id),
    /** null = ルート部署 */
    parentId: text("parent_id").references((): AnySQLiteColumn => departments.id),
    name: text("name").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [index("departments_tenant_parent_idx").on(table.tenantId, table.parentId)],
);

export const memberships = sqliteTable(
  "memberships",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    departmentId: text("department_id")
      .notNull()
      .references(() => departments.id),
    /** 役職(任意) */
    title: text("title"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    index("memberships_tenant_user_idx").on(table.tenantId, table.userId),
    index("memberships_tenant_department_idx").on(table.tenantId, table.departmentId),
  ],
);
