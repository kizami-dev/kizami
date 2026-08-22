/**
 * closings(締め)と closing_snapshots。
 *
 * - 締め/解除は closings テーブルを UPDATE せず、**closing_events(追記専用)** で履歴を持ち、
 *   現在状態(open/closed)はそこから導出する(docs/design/v01-data-model.md §closings(締め)と
 *   closing_snapshots)。「誰がいつ締め/解除したか」(要件§6)を構造で満たす
 * - 締めはテナント単位・月単位(全員まとめて確定)。closing_events は user_id を持たない
 * - closing_snapshots: 締め確定時の (closing_event_id, user_id, category, minutes)。
 *   締め済み期間の月次表示・エクスポートは常にここから読む(設定変更・制度変更の遡及から
 *   二重に保護する。原則6参照)
 *
 * 締め後修正(amend, v0.4): `event` に `'amend'` を追加する。close/reopen と違い、amend は
 * 締め状態(open/closed)を変えない(closed のまま)— 締め済み月に影響する修正申請・休暇申請の
 * 承認を「月全体を解除せずに」反映するための追記イベント。`correction_request_id` /
 * `leave_request_id`(いずれも null 可、amend の由来を1つだけ持つ)で「どの申請による修正か」を
 * 構造で残す(apps/api/src/routes/corrections.ts・leave.ts が承認時に追記する)。
 *
 * 判断点(amend のスナップショット世代の単位, 依頼原文「新しい event に対する行を追加するだけで
 * よい」を採用): amend は影響を受けた1ユーザー分の行だけを新しい closing_event_id に紐づけて
 * 追加する(締め時のように全ユーザー分をコピーし直さない)。そのため「ある period の現在の
 * スナップショット」はもはや「1つの closing_event_id に紐づく行の集合」では求まらず、
 * ユーザーごとに「そのユーザーの行を含む直近の close/amend イベント」を個別に特定する必要がある
 * — 読み出し側(getClosingSnapshots, queries/closings.ts)がこの解決をアプリケーション側で行う。
 *
 * 判断点(category の設計, 依頼側で実装者判断とされた点): flex 収支(frameMinutes /
 * actualMinutes / diffMinutes)を別カラムに分けず、区分別時間数(TimeCategory)と同じ
 * `category` + `minutes` の1行1値形式に寄せた。理由:
 * - closing_snapshots は「(closing_event_id, user_id) に対する複数の名前付き数値」を保存する
 *   だけのテーブルであり、区分と flex 収支は「集計結果のキー・バリュー」という点で同種のデータ。
 *   別カラム(flex_frame_minutes 等)を追加すると、区分別時間数(5種)と flex 収支(3種)で
 *   保存の形が非対称になり、読み出し側(getClosingSnapshots)も2種類の形を組み立てる必要が出る
 * - diffMinutes は負値を取りうるが `minutes` は符号付き integer なので問題なく保存できる
 * - デメリット: category が本来 `TimeCategory`(engine 側の型)ではなくなり、DB 層独自の
 *   拡張列挙(CLOSING_SNAPSHOT_CATEGORIES, 本ファイル export)になる。呼び出し側
 *   (apps/api/src/lib/closing-snapshot.ts)がこの拡張列挙とエンジンの型のマッピングを担う
 *
 * 参照: docs/design/v01-data-model.md §closings(締め)と closing_snapshots、
 * docs/requirements.md §6(締めと出口)、docs/design/permission-catalog.md §1.5(締め)
 */

import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { correctionRequests } from "./corrections.js";
import { leaveRequests } from "./leave.js";
import { tenants } from "./tenants.js";
import { users } from "./users.js";

/** 区分別時間数5種 + flex収支3種(上記コメント参照)。DB 層は文字列として保持し、中身は解釈しない。 */
export const CLOSING_SNAPSHOT_CATEGORIES = [
  "statutory",
  "overtime",
  "overtime60h",
  "lateNight",
  "statutoryHoliday",
  "flexFrame",
  "flexActual",
  "flexDiff",
] as const;
export type ClosingSnapshotCategory = (typeof CLOSING_SNAPSHOT_CATEGORIES)[number];

export const closingEvents = sqliteTable(
  "closing_events",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id),
    /** "YYYY-MM" */
    period: text("period").notNull(),
    /** close / reopen / amend */
    event: text("event").notNull(),
    actorId: text("actor_id")
      .notNull()
      .references(() => users.id),
    note: text("note"),
    /** event='amend' で、由来が打刻修正申請の承認の場合のみ。close/reopen・休暇申請由来は null */
    correctionRequestId: text("correction_request_id").references(() => correctionRequests.id),
    /** event='amend' で、由来が休暇申請の承認の場合のみ。close/reopen・修正申請由来は null */
    leaveRequestId: text("leave_request_id").references(() => leaveRequests.id),
    /** UTC エポック分 */
    occurredAt: integer("occurred_at").notNull(),
  },
  (table) => [index("closing_events_tenant_period_occurred_idx").on(table.tenantId, table.period, table.occurredAt)],
);

export const closingSnapshots = sqliteTable(
  "closing_snapshots",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id),
    /** どの close イベントで作られたか(reopen 後の再締めは新しい closing_event_id を持つ新しい行になる) */
    closingEventId: text("closing_event_id")
      .notNull()
      .references(() => closingEvents.id),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    /** ClosingSnapshotCategory のいずれか */
    category: text("category").notNull(),
    /** 分。flexDiff は負値を取りうる */
    minutes: integer("minutes").notNull(),
  },
  (table) => [
    index("closing_snapshots_tenant_event_idx").on(table.tenantId, table.closingEventId),
    uniqueIndex("closing_snapshots_event_user_category_idx").on(table.closingEventId, table.userId, table.category),
  ],
);
