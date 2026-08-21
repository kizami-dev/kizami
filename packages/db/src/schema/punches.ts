/**
 * punch_events — 打刻イベント(追記専用)。UPDATE/DELETE は発行しない。
 *
 * - 「取消」は kind を引き継がず supersedes_id のみ持つ専用 kind `void` で表現する
 * - 有効イベント = 他のイベントの supersedes_id に参照されていないもの。
 *   同一イベントを二重に無効化することは `supersedes_id` の UNIQUE 制約で禁止する
 * - correction_request_id は v0.2 で追加される correction_requests テーブルへの論理参照。
 *   v0.1 では対象テーブルが存在しないため FK 制約は張らない(カラムのみ用意)
 *
 * 参照: docs/design/v01-data-model.md §punch_events(追記専用)
 */

import { index, integer, real, sqliteTable, text, uniqueIndex, type AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import { tenants } from "./tenants.js";
import { users } from "./users.js";

export const punchEvents = sqliteTable(
  "punch_events",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id),
    /** 打刻の対象者 */
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    /** clock_in / clock_out / break_start / break_end / void */
    kind: text("kind").notNull(),
    /** 労働時間計算に使う時刻(UTC エポック分) */
    occurredAt: integer("occurred_at").notNull(),
    /** サーバーが受理した時刻(UTC エポック分) */
    recordedAt: integer("recorded_at").notNull(),
    /** web / pwa / slack / api / mcp */
    source: text("source").notNull(),
    /** 誰が記録したか。本人打刻なら user_id と同じ、承認反映なら承認者 */
    actorId: text("actor_id")
      .notNull()
      .references(() => users.id),
    /** 無効化する対象イベント。訂正・取消のときのみ */
    supersedesId: text("supersedes_id").references((): AnySQLiteColumn => punchEvents.id),
    /** 修正申請の承認による反映の場合、その申請への参照(v0.2 correction_requests、FK なし) */
    correctionRequestId: text("correction_request_id"),
    note: text("note"),
    metaIp: text("meta_ip"),
    metaUa: text("meta_ua"),
    /** テナント設定で GPS 有効時のみ。保持期間経過後は null 化(行は消さない) */
    metaGpsLat: real("meta_gps_lat"),
    metaGpsLng: real("meta_gps_lng"),
  },
  (table) => [
    index("punch_events_tenant_user_occurred_idx").on(table.tenantId, table.userId, table.occurredAt),
    uniqueIndex("punch_events_supersedes_idx").on(table.supersedesId),
  ],
);
