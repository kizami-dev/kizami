/**
 * シフト制(monthly_variable)のテーブル群。参照: docs/design/shift-work.md 決定事項1・2。
 *
 * - `shift_patterns`: 早番/遅番/休み等の定義(tenant単位)。週グリッドへの割当元
 * - `shift_plans`: 変形期間の器(tenant, user, period_start, period_end, published_at)。
 *   `shift_days` は必ずどれか1つの plan に属する(その日を最初に確定させた/計画した plan)
 * - `shift_days`: user × date の所定。punch_events と同じ**追記専用・supersedes 型**
 *   (UPDATE/DELETE は発行しない。有効行の解決は NOT EXISTS(supersedes_id = id)、
 *   packages/db/src/queries/shifts.ts 参照)。確定前後を問わず常にこの supersede
 *   メカニズムで書く — 確定前の「上書き」も確定後の「訂正」も同じ1つの実装で表現できる
 *   (違いは呼び出し側〔apps/api/src/routes/shifts.ts〕が要求する権限・監査ログの粒度のみ)。
 */

import { index, integer, sqliteTable, text, uniqueIndex, type AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import { tenants } from "./tenants.js";
import { users } from "./users.js";

/**
 * シフトパターン(早番/遅番/休み等)の定義。archivedAt が null なら使用可能。
 * 過去に割り当てた shift_days.pattern_id が指す行は archivedAt 後も残す(履歴保護のため
 * 物理削除しない — punch_events 系と同じ「追記専用ログは消さない」方針)。
 */
export const shiftPatterns = sqliteTable(
  "shift_patterns",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id),
    name: text("name").notNull(),
    /** work | legal_holiday | non_working(engine の ShiftDayType と同じ語彙) */
    dayType: text("day_type").notNull(),
    /** ローカル0時からの分。dayType が work 以外なら 0(engine の ShiftDay と同じ契約) */
    startMinutes: integer("start_minutes").notNull(),
    /** ローカル0時からの分。startMinutes より小さければ日跨ぎ。dayType が work 以外なら 0 */
    endMinutes: integer("end_minutes").notNull(),
    breakMinutes: integer("break_minutes").notNull(),
    createdAt: integer("created_at").notNull(),
    /** UTC エポック分。null なら使用可能。アーカイブは論理削除(行は残す) */
    archivedAt: integer("archived_at"),
  },
  (table) => [index("shift_patterns_tenant_idx").on(table.tenantId)],
);

/**
 * 変形期間の器。1 user × 1期間([periodStart, periodEnd])につき高々1件
 * (同じユーザー・重複する期間の plan を複数作ることは apps/api 側で防ぐ)。
 * publishedAt が null なら未確定(下書き)。
 */
export const shiftPlans = sqliteTable(
  "shift_plans",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    /** ローカル日付 "YYYY-MM-DD"(両端含む) */
    periodStart: text("period_start").notNull(),
    periodEnd: text("period_end").notNull(),
    /** UTC エポック分。null なら未確定 */
    publishedAt: integer("published_at"),
    publishedBy: text("published_by").references(() => users.id),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [index("shift_plans_tenant_user_period_idx").on(table.tenantId, table.userId, table.periodStart)],
);

/**
 * user × date の所定(追記専用・supersedes 型)。有効行 = 他のどの行の supersedes_id からも
 * 参照されていない行(NOT EXISTS、packages/db/src/queries/shifts.ts の listValidShiftDaysInRange
 * 参照。punch_events の listValidPunches と同じ解決規則)。
 */
export const shiftDays = sqliteTable(
  "shift_days",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    /** ローカル日付 "YYYY-MM-DD" */
    date: text("date").notNull(),
    /** work | legal_holiday | non_working */
    dayType: text("day_type").notNull(),
    /** dayType が work 以外なら 0(engine の ShiftDay と同じ契約) */
    startMinutes: integer("start_minutes").notNull(),
    endMinutes: integer("end_minutes").notNull(),
    breakMinutes: integer("break_minutes").notNull(),
    /** この行が特定のシフトパターンから作られた場合の参照。個別編集(パターン未使用)なら null */
    patternId: text("pattern_id").references(() => shiftPatterns.id),
    /** この行が属する plan(その日を最初に計画した plan。確定後の訂正行も同じ plan_id を引き継ぐ) */
    planId: text("plan_id")
      .notNull()
      .references(() => shiftPlans.id),
    /** 無効化する対象行。訂正のときのみ(punch_events.supersedes_id と同じ意味論) */
    supersedesId: text("supersedes_id").references((): AnySQLiteColumn => shiftDays.id),
    /** 記録した人(本人が自分のシフトを編集することは無い想定だが、型としては users を指す) */
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    index("shift_days_tenant_user_date_idx").on(table.tenantId, table.userId, table.date),
    index("shift_days_plan_idx").on(table.planId),
    uniqueIndex("shift_days_supersedes_idx").on(table.supersedesId),
  ],
);
