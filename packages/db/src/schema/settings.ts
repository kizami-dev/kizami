/**
 * effective-dated な制度・設定テーブル群。
 *
 * 参照: docs/design/v01-data-model.md 原則6 / §組織・認証・権限
 *
 * - `tenant_setting_versions`: 計算に影響するテナント設定の版(追記専用)
 * - `work_policies` / `work_policy_versions`: 労働時間制の定義(フレックスタイム制 / 固定時間制)。版管理
 * - `user_policy_assignments`: user × work_policy の適用開始日(これも effective-dated)
 *
 * いずれも UPDATE せず新しい版(行)を追加することで変更を表現する。
 */

import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { tenants } from "./tenants.js";
import { users } from "./users.js";

/**
 * テナント設定の版(追記専用)。
 *
 * `legalHolidayRule` / `breakRule` は型付き構造(packages/engine の LegalHolidayRule /
 * CalcSettings["breakRule"] 相当)を JSON 文字列として保持する。DB 層は中身を解釈しない。
 */
export const tenantSettingVersions = sqliteTable(
  "tenant_setting_versions",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id),
    /** ローカル日付 "YYYY-MM-DD"。この日から有効 */
    effectiveFrom: text("effective_from").notNull(),
    /** 日界: ローカル0時からの分(0〜1439) */
    dayBoundaryMinutes: integer("day_boundary_minutes").notNull(),
    /** LegalHolidayRule の JSON 表現 */
    legalHolidayRule: text("legal_holiday_rule").notNull(),
    /** breakRule の JSON 表現({ mode: "punch" | "auto" | "both" }) */
    breakRule: text("break_rule").notNull(),
    gpsEnabled: integer("gps_enabled", { mode: "boolean" }).notNull(),
    /** null = 勤怠データと同一の保持期間 */
    gpsRetentionDays: integer("gps_retention_days"),
    /**
     * 週の起算曜日(0=日曜〜6=土曜)。固定時間制で「週40時間超」を判定する起点として使う
     * (フレックスタイム制では清算期間内の総枠で判定するため参照しない)。
     * 2026-08-23 固定時間制対応で追加。既存行のマイグレーションでは 0(日曜)を入れる
     * (`.default(0)` は ALTER TABLE ... NOT NULL 追加に必要な SQLite 上の都合であり、
     * 新規作成時は insertTenantSettingVersion の呼び出し側が明示的に指定する — 既定値を
     * クエリ層で決め打ちしない)。
     */
    weekStartWeekday: integer("week_start_weekday").notNull().default(0),
    /** UTC エポック分(この版が記録された時刻) */
    createdAt: integer("created_at").notNull(),
  },
  (table) => [index("tenant_setting_versions_tenant_effective_idx").on(table.tenantId, table.effectiveFrom)],
);

/** 労働時間制の定義(識別子側)。版は work_policy_versions が持つ */
export const workPolicies = sqliteTable("work_policies", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id")
    .notNull()
    .references(() => tenants.id),
  name: text("name").notNull(),
  createdAt: integer("created_at").notNull(),
});

/**
 * work_policies の版(追記専用)。労働時間制の種別を `kind` で区別する:
 * - `"flex"`(フレックスタイム制): `settlementPeriod`(清算期間)/ `core`(コアタイム)を使う
 * - `"fixed"`(固定時間制): `settlementPeriod` / `core` は無視される(列自体は NOT NULL のまま
 *   残すため、fixed でも `settlementPeriod` には便宜上 "monthly" を、`core` には null を入れておく)
 *
 * 2026-08-23 固定時間制対応で `kind` を追加。既存行のマイグレーションでは "flex" を入れる。
 */
export const workPolicyVersions = sqliteTable(
  "work_policy_versions",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id),
    workPolicyId: text("work_policy_id")
      .notNull()
      .references(() => workPolicies.id),
    effectiveFrom: text("effective_from").notNull(),
    /**
     * 労働時間制の種別: "flex"(フレックスタイム制) | "fixed"(固定時間制)。
     * `.default("flex")` は ALTER TABLE ... NOT NULL 追加に必要な SQLite 上の都合であり、
     * 新規作成時は insertWorkPolicyVersion の呼び出し側が明示的に指定する
     * (既定値をクエリ層で決め打ちしない)。
     */
    kind: text("kind").notNull().default("flex"),
    /** 清算期間。flex 専用("monthly" 固定)。kind = "fixed" のときは無視される */
    settlementPeriod: text("settlement_period").notNull(),
    /** コアタイム。flex 専用。v0.1 未対応のため常に null。kind = "fixed" のときは無視される */
    core: text("core"),
    /** 標準となる1日の労働時間(分)。有給日の枠算入に使う(engine の FlexSettings.standardDayMinutes 相当) */
    standardDayMinutes: integer("standard_day_minutes").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    index("work_policy_versions_tenant_effective_idx").on(table.tenantId, table.effectiveFrom),
    index("work_policy_versions_policy_effective_idx").on(table.workPolicyId, table.effectiveFrom),
  ],
);

/** user × work_policy の適用開始日(これも effective-dated) */
export const userPolicyAssignments = sqliteTable(
  "user_policy_assignments",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    workPolicyId: text("work_policy_id")
      .notNull()
      .references(() => workPolicies.id),
    effectiveFrom: text("effective_from").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [index("user_policy_assignments_tenant_user_effective_idx").on(table.tenantId, table.userId, table.effectiveFrom)],
);
