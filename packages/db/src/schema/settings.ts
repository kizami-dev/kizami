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
    /**
     * 1ヶ月単位の変形労働時間制(monthly_variable)の変形期間の起点日(1〜28、
     * docs/design/shift-work.md 決定事項3)。work_policy_versions.kind が "monthly_variable" の
     * テナントでのみ意味を持つ(engine の WorkSystem["monthly_variable"].periodStartDay の
     * 供給元。apps/api/src/lib/settings.ts の buildSettingsTimeline 参照)。
     * `.default(1)` は ALTER TABLE ... NOT NULL 追加に必要な SQLite 上の都合であり(既存の
     * weekStartWeekday と同じ理由)、新規作成時は insertTenantSettingVersion の呼び出し側が
     * 明示的に指定する。1〜28 に制限する理由は WorkSystem 型のコメント参照(29〜31日は
     * 月によって存在しないため起点が一意に決まらない)。
     */
    variablePeriodStartDay: integer("variable_period_start_day").notNull().default(1),
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
 * - `"fixed"` / `"monthly_variable"`: `settlementPeriod` / `core` は無視される(列自体は残るため、
 *   `settlementPeriod` には便宜上 "monthly" を、`core` には null を入れておく)
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
    /**
     * コアタイム(labor law §32-3)。flex 専用で、未設定(スーパーフレックス)なら null。
     * 値は engine の `CoreTime` を素直に写した JSON 文字列:
     * `{"startMinutes":600,"endMinutes":900,"weekdays":[1,2,3,4,5]}`(weekdays は省略可)。
     *
     * 判断点(2026-08-24, コアタイム対応): 開始/終了を別々の integer 列にせず既存の text 列へ
     * JSON で入れる。legal_holiday_rule・break_rule と同じ流儀(構造を持つ設定値は JSON 1列)で、
     * 曜日集合のような可変長の要素を後から足しても列追加のマイグレーションが要らない。
     * kind が flex 以外のときは無視される。
     */
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
