/**
 * notifications — アプリ内通知(v0.2 第二弾: 通知基盤・打刻忘れリマインド)。
 *
 * 既定の通知チャネルはアプリ内(このテーブル)。メール/Webhook は設定があるときだけ
 * 追加で送る(@kizami/notify)が、その送信結果はこのテーブルには反映しない
 * (在/不在の記録責務は呼び出し側)。
 *
 * 重複防止: UNIQUE(tenant_id, user_id, type, subject_date) — 同じ勤怠日の同じ種類の通知は
 * 1通のみ(打刻忘れリマインドの定期スキャンが何度走っても二重通知しないため)。
 *
 * 判断点: SQLite の UNIQUE インデックスは NULL 値同士を区別する(NULL は互いに等しいとみなされず、
 * 重複と判定されない)。missing_clock_out は常に subject_date を持つためこの制約で狙った
 * 重複防止になるが、将来 subject_date を持たない通知種別を追加する場合は
 * この制約だけでは重複防止にならない点に注意。
 *
 * 参照: docs/requirements.md §7(通知チャネル: メール/Webhook/アプリ内)
 */

import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { tenants } from "./tenants.js";
import { users } from "./users.js";

export const notifications = sqliteTable(
  "notifications",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    /** 通知種別(例: 'missing_clock_out') */
    type: text("type").notNull(),
    /** 通知が紐づく勤怠日 "YYYY-MM-DD"。日付に紐づかない通知種別は null */
    subjectDate: text("subject_date"),
    title: text("title").notNull(),
    body: text("body").notNull(),
    /** UTC エポック分 */
    createdAt: integer("created_at").notNull(),
    /** UTC エポック分。未読は null */
    readAt: integer("read_at"),
  },
  (table) => [
    uniqueIndex("notifications_tenant_user_type_subject_date_idx").on(
      table.tenantId,
      table.userId,
      table.type,
      table.subjectDate,
    ),
    index("notifications_tenant_user_created_idx").on(table.tenantId, table.userId, table.createdAt),
  ],
);
