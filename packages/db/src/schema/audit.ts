/**
 * audit_logs(追記専用) — 打刻以外の変更(テナント設定・プリセット編集・割当・締め操作・認証イベント等)を記録する。
 * 打刻の監査は punch_events 自体が担うため二重記録しない。
 *
 * 参照: docs/design/v01-data-model.md §audit_logs(追記専用)
 */

import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { tenants } from "./tenants.js";
import { users } from "./users.js";

export const auditLogs = sqliteTable(
  "audit_logs",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id),
    actorId: text("actor_id")
      .notNull()
      .references(() => users.id),
    action: text("action").notNull(),
    target: text("target").notNull(),
    /** 変更前後のダイジェスト(JSON 文字列 or ハッシュ。中身は DB 層では解釈しない) */
    beforeDigest: text("before_digest"),
    afterDigest: text("after_digest"),
    occurredAt: integer("occurred_at").notNull(),
  },
  (table) => [
    index("audit_logs_tenant_occurred_idx").on(table.tenantId, table.occurredAt),
    // 監査ログ閲覧API(GET /audit-logs、Tier 1)のカーソルページング用。id は UUIDv7 で
    // 時系列ソート可能なため、`WHERE tenant_id = ? [AND id < cursor] ORDER BY id DESC` を
    // この複合インデックスだけで(追加のソートステップ無しに)処理できる。
    index("audit_logs_tenant_id_idx").on(table.tenantId, table.id),
  ],
);
