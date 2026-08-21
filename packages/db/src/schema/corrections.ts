/**
 * correction_requests — 打刻修正申請(訂正・追加・取消の3ケースを表現する)。
 *
 * - user_id: 対象者(誰の打刻を直すか) / requested_by: 申請者。「代理申請に備える」ため分離しているが、
 *   v0.2 第一弾の apps/api は本人申請のみを受け付けるため、作成時は常に user_id === requested_by になる
 * - ケースの見分け方:
 *   - target_event_id が null → 追加(proposed_kind / proposed_occurred_at を伴う)
 *   - target_event_id があり proposed_kind / proposed_occurred_at もある → 訂正
 *   - target_event_id のみで proposed_kind / proposed_occurred_at が両方 null → 取消
 * - 状態遷移は pending → approved / rejected / withdrawn のみ。approved 後の変更は不可
 *   (取り消したい場合は新たな申請)
 * - 承認時、punch_events への反映イベント追記とこの行の status 更新を1トランザクションで行う
 *   (apps/api/src/routes/corrections.ts が実装する)
 *
 * 参照: docs/design/v01-data-model.md §correction_requests(修正申請)
 */

import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { punchEvents } from "./punches.js";
import { tenants } from "./tenants.js";
import { users } from "./users.js";

export const correctionRequests = sqliteTable(
  "correction_requests",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id),
    /** 対象者(誰の打刻を直すか) */
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    /** 申請者。代理申請に備えて user_id と分離(v0.2 第一弾は常に user_id と同一) */
    requestedBy: text("requested_by")
      .notNull()
      .references(() => users.id),
    /** pending / approved / rejected / withdrawn */
    status: text("status").notNull(),
    /** 訂正・取消の対象。新規追加申請なら null */
    targetEventId: text("target_event_id").references(() => punchEvents.id),
    /** 申請内容(kind)。追加・訂正のみ持つ(取消は null) */
    proposedKind: text("proposed_kind"),
    /** 申請内容(UTC エポック分)。追加・訂正のみ持つ(取消は null) */
    proposedOccurredAt: integer("proposed_occurred_at"),
    /** 申請理由(必須) */
    reason: text("reason").notNull(),
    decidedBy: text("decided_by").references(() => users.id),
    /** UTC エポック分 */
    decidedAt: integer("decided_at"),
    decisionNote: text("decision_note"),
    /** UTC エポック分 */
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    index("correction_requests_tenant_user_status_idx").on(table.tenantId, table.userId, table.status),
    index("correction_requests_tenant_status_idx").on(table.tenantId, table.status),
  ],
);
