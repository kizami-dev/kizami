/**
 * help_overrides — テナントが組み込みヘルプ(@kizami/help-content)に追記する「自社の規定」。
 *
 * 参照: packages/help-content/README.md の origin=company、docs/design/ui-direction.md
 * 「ガイド・ヘルプの方針 > 社内規定の併記」。
 *
 * `help_key` は @kizami/help-content の HelpKey のいずれか(API 層で検証する。DB 層は文字列を
 * そのまま保持するだけで HelpKey の union を持ち込まない — packages/db は packages/help-content
 * に依存しない独立レイヤの原則を保つため)。1テナント×1キーにつき最新の1件のみを保持する
 * 単純な現在値テーブル(tenant_notification_settings と同じ考え方。改訂履歴は持たない)。
 *
 * PK を (tenant_id, help_key) の複合にしているのは、tenant_notification_settings のような
 * 「テナントにつき1行」ではなく「テナント×ヘルプキーにつき1行」だから。
 */

import { primaryKey, sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { tenants } from "./tenants.js";
import { users } from "./users.js";

export const helpOverrides = sqliteTable(
  "help_overrides",
  {
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id),
    /** @kizami/help-content の HelpKey(例: "leave.mandatory-five-days")。API 層でカタログ照合する */
    helpKey: text("help_key").notNull(),
    /** 自社規定の本文(Markdown)。空文字は保存しない — API 層で空文字は削除として扱う */
    bodyMd: text("body_md").notNull(),
    updatedBy: text("updated_by")
      .notNull()
      .references(() => users.id),
    /** UTC エポック分 */
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.tenantId, table.helpKey] })],
);
