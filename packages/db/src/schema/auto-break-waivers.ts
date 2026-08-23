/**
 * auto_break_waivers — 自動控除された休憩を打ち消す申請(追記専用)。
 *
 * 背景(docs/design/breaks.md「自動控除をどう設計するか」参照): `tenant_setting_versions.break_rule`
 * が 'auto' | 'both' のとき、集計エンジンは打刻の有無にかかわらず所定の休憩を機械的に控除する。
 * これは労働時間の過少申告(サービス残業の温床)になり得るため、「実際には休憩を取れなかった」
 * 本人がその日の自動控除を打ち消せることが必須の対になる機能である。
 *
 * `correction_requests` を使わない理由: correction_requests は `punch_events` の特定の1行
 * (target_event_id)に強く結びついた訂正・追加・取消を表現するテーブルであり、そもそも打刻が
 * 存在しない自動控除には適用できない。目的が異なるため、`leave_requests` と同じ「追記専用の
 * 申請テーブル」の流儀で別テーブルとして持つ。
 *
 * - user_id: 対象者(誰の自動控除を打ち消すか) / requested_by: 申請者。correction_requests /
 *   leave_requests と同様に代理申請に備えて分離しているが、v0.2 第一弾は本人申請のみのため
 *   作成時は常に user_id === requested_by になる
 * - waive_date: 打ち消す日(ローカル "YYYY-MM-DD")。出勤〜退勤の1勤務区間(WorkStretch)は
 *   その区間が「始まる」日に属するものとして扱う(breaks.md の判定単位に合わせる)。
 *   日をまたぐ夜勤でも、区間の開始日1つを指定すればその区間の自動控除を打ち消せる
 * - 状態遷移は pending → approved / rejected / withdrawn のみ。correction_requests /
 *   leave_requests と同じ形
 * - 承認済みの waive_date は集計エンジンの `autoBreakWaivedDates` 入力に渡り、
 *   その勤務区間には自動控除を適用しない(queries/auto-break-waivers.ts の
 *   listApprovedWaiverDatesInRange が橋渡しする)
 * - 同一 user × waive_date で approved が重複しないよう、部分 UNIQUE index
 *   (status = 'approved' の行のみを対象)を張る。SQLite は部分インデックスをネイティブサポートしており、
 *   drizzle-kit もこれをマイグレーションとして生成できるため、DB レベルで二重承認を防ぐ
 */

import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { tenants } from "./tenants.js";
import { users } from "./users.js";

export const autoBreakWaivers = sqliteTable(
  "auto_break_waivers",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id),
    /** 対象者(誰の自動控除を打ち消すか) */
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    /** 申請者。代理申請に備えて user_id と分離(v0.2 第一弾は常に user_id と同一) */
    requestedBy: text("requested_by")
      .notNull()
      .references(() => users.id),
    /** pending / approved / rejected / withdrawn */
    status: text("status").notNull(),
    /** ローカル日付 "YYYY-MM-DD"。打ち消す日(この日に始まる勤務区間の自動控除を無効化) */
    waiveDate: text("waive_date").notNull(),
    /** 申請理由(必須)。「実際に休憩を取れなかった」の具体的な事情 */
    reason: text("reason").notNull(),
    decidedBy: text("decided_by").references(() => users.id),
    /** UTC エポック分 */
    decidedAt: integer("decided_at"),
    decisionNote: text("decision_note"),
    /** UTC エポック分 */
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    index("auto_break_waivers_tenant_user_status_idx").on(table.tenantId, table.userId, table.status),
    index("auto_break_waivers_tenant_user_date_idx").on(table.tenantId, table.userId, table.waiveDate),
    // listApprovedWaiverDatesInRange(queries/auto-break-waivers.ts)は tenant_id・user_id・
    // status='approved'・waive_date の範囲を同時に絞り込む。上の2つの3カラム index はそれぞれ
    // status か waive_date のどちらか片方までしかカバーせず、この4条件同時の絞り込みには
    // 单独では効かない(status 側の index なら waive_date の範囲比較で追加スキャンが要り、
    // date 側の index なら status の等値フィルタで追加スキャンが要る)。締め処理・打刻忘れ
    // リマインド・36協定アラートのすべてがユーザーごとにこの関数を呼ぶ高頻度パスのため、
    // 4カラムそろえた複合 index を別途持つ。
    index("auto_break_waivers_tenant_user_status_date_idx").on(table.tenantId, table.userId, table.status, table.waiveDate),
    // 同一 user × waive_date の approved 重複を DB レベルで防ぐ部分 UNIQUE index。
    // pending/rejected/withdrawn は対象外(同日への再申請・却下後の再申請を妨げないため)。
    uniqueIndex("auto_break_waivers_approved_unique_idx")
      .on(table.tenantId, table.userId, table.waiveDate)
      .where(sql`${table.status} = 'approved'`),
  ],
);
