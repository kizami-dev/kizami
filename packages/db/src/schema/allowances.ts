/**
 * 手当定義(effective-dated、追記専用)。docs/design/allowances.md 参照。
 *
 * work_policies / work_policy_versions(settings.ts)と同じ「識別子テーブル + 版テーブル」の
 * 形だが、work_policy が「テナントにつき常に1件」という前提を持つのに対し、手当定義は
 * テナント内に何件も並行して存在しうる(早朝手当・年末年始手当・特定日出勤手当…)。そのため
 * 版の解決(ある日にどの手当が有効か)は「定義ごとに独立した effective-dated 系列」として行う
 * 必要があり、`allowance_definition_versions` は `definition_id` でグループ化したうえで
 * 各グループ内で `effective_from` 昇順に解決する(packages/db/src/queries/allowances.ts、
 * packages/engine/src/allowances.ts の resolveAllowanceDefinitionsForDate と同じ考え方)。
 */

import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { tenants } from "./tenants.js";

/** 手当定義の識別子側。版は allowance_definition_versions が持つ(名前も版が持つ — work_policies と同じ) */
export const allowanceDefinitions = sqliteTable("allowance_definitions", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id")
    .notNull()
    .references(() => tenants.id),
  /** UTC エポック分 */
  createdAt: integer("created_at").notNull(),
});

/**
 * allowance_definitions の版(追記専用)。`conditions` は engine の
 * `AllowanceDefinition["conditions"]`({ dates?, weekdays?, timeBand? })の JSON 文字列表現。
 * DB 層は中身を解釈しない(tenantSettingVersions.legalHolidayRule と同じ流儀)。
 */
export const allowanceDefinitionVersions = sqliteTable(
  "allowance_definition_versions",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id),
    definitionId: text("definition_id")
      .notNull()
      .references(() => allowanceDefinitions.id),
    /** ローカル日付 "YYYY-MM-DD"。この日から有効 */
    effectiveFrom: text("effective_from").notNull(),
    name: text("name").notNull(),
    /** AllowanceDefinition["conditions"] の JSON 文字列 */
    conditions: text("conditions").notNull(),
    /** UTC エポック分 */
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    index("allowance_definition_versions_tenant_effective_idx").on(table.tenantId, table.effectiveFrom),
    index("allowance_definition_versions_definition_effective_idx").on(table.definitionId, table.effectiveFrom),
  ],
);
