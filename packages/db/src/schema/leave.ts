/**
 * 有給休暇管理(§5)のテーブル群。
 *
 * - `tenant_leave_settings`: テナント単位の付与方式・時間単位年休・積立休暇の設定(1テナント1行)
 * - `leave_grants`: 有給の付与(法定自動付与・手動付与・積立への振替の3経路すべてをここに記録する)
 * - `leave_requests`: 休暇申請(correction_requests と同じ形のワークフロー: pending → approved/rejected/withdrawn)
 *
 * 残高・消化の計算は分単位で行う(packages/leave 参照)。`leave_grants.days` は法令上の管理単位
 * (付与日数)として保持し、分への換算はテナントの標準労働時間(所定労働時間)を係数として
 * apps/api 層が行う。
 *
 * 判断点: `leave_grants` に (tenantId, userId, grantedOn) の DB レベル一意制約は張らない。
 * 積立休暇への振替(convert-expired)は同一実行で複数の失効付与を同じ日付(実行日)に
 * 変換しうるため、同一ユーザー・同一日付で複数行になり得る。法定自動付与の冪等性は
 * クエリ層(listGrantedOnDates)で既存の grantedOn を確認してから insert する形で担保する。
 */

import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { tenants } from "./tenants.js";
import { users } from "./users.js";

/**
 * テナント単位の有給付与方式・時間単位年休・積立休暇の設定。tenant_id が PK(1テナント1行)。
 *
 * hourlyLeaveMaxDays: 時間単位年休の年度あたり上限日数(労使協定、1〜5日。既定5。
 * 根拠: 労働基準法39条4項)。分への換算は packages/leave/src/hourly.ts
 * (1時間未満切り上げ)を使う。
 */
export const tenantLeaveSettings = sqliteTable("tenant_leave_settings", {
  tenantId: text("tenant_id")
    .primaryKey()
    .references(() => tenants.id),
  /** 'statutory'(法定・入社日基準) | 'fixed_date'(基準日方式・全社一斉) */
  grantMethod: text("grant_method").notNull(),
  /** grantMethod='fixed_date' の場合のみ使用。"MM-DD" */
  fixedDateMmDd: text("fixed_date_mm_dd"),
  /** 時間単位年休(労基法39条4項)。労使協定が前提のため既定 false */
  hourlyLeaveEnabled: integer("hourly_leave_enabled", { mode: "boolean" }).notNull().default(false),
  /** 時間単位年休の年度あたり上限日数(1〜5)。既定5 */
  hourlyLeaveMaxDays: integer("hourly_leave_max_days").notNull().default(5),
  /** 半休。労使協定不要(行政解釈)のため既定 true */
  halfDayLeaveEnabled: integer("half_day_leave_enabled", { mode: "boolean" }).notNull().default(true),
  /** 失効年休積立制度。既定 false */
  stockConversionEnabled: integer("stock_conversion_enabled", { mode: "boolean" }).notNull().default(false),
  /** 積立休暇の残高上限(日数)。既定40 */
  stockMaxDays: integer("stock_max_days").notNull().default(40),
  /** 積立休暇自体の有効期限(月数)。null = 無期限 */
  stockExpiresMonths: integer("stock_expires_months"),
  updatedAt: integer("updated_at").notNull(),
  updatedBy: text("updated_by")
    .notNull()
    .references(() => users.id),
});

/** 有給の付与(法定自動付与・手動付与・積立への振替の3経路すべてをここに記録する)。 */
export const leaveGrants = sqliteTable(
  "leave_grants",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    /** 'annual'(通常の年次有給) | 'stocked'(積立休暇) */
    leaveType: text("leave_type").notNull(),
    /** ローカル日付 "YYYY-MM-DD"。付与日 */
    grantedOn: text("granted_on").notNull(),
    days: integer("days").notNull(),
    /** ローカル日付 "YYYY-MM-DD"。時効日(annual は付与から2年。stocked はテナント設定次第) */
    expiresOn: text("expires_on").notNull(),
    /** 'auto'(法定付与の自動計算) | 'manual'(管理者による個別調整) | 'conversion'(失効分の積立振替) */
    source: text("source").notNull(),
    /** source='conversion' の場合のみ。振替元の leave_grants.id(自己参照。FK制約は張らない) */
    convertedFromGrantId: text("converted_from_grant_id"),
    note: text("note"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    index("leave_grants_tenant_user_idx").on(table.tenantId, table.userId),
    index("leave_grants_converted_from_idx").on(table.convertedFromGrantId),
  ],
);

/**
 * 休暇申請。correction_requests と同じ形のワークフロー(pending → approved/rejected/withdrawn)。
 *
 * unit: 'full_day' | 'half_day_am' | 'half_day_pm' | 'hourly'。
 * minutes: unit='hourly' のときのみ必須(申請された分数)。full_day/half_day_* は
 * 消化時点の所定労働時間から動的に解決する(標準労働時間の変更を遡って反映できるよう、
 * 申請時点の値を固定保存しない設計判断)。
 */
export const leaveRequests = sqliteTable(
  "leave_requests",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    requestedBy: text("requested_by")
      .notNull()
      .references(() => users.id),
    /** pending / approved / rejected / withdrawn */
    status: text("status").notNull(),
    /** ローカル日付 "YYYY-MM-DD" */
    leaveDate: text("leave_date").notNull(),
    /** 'full_day' | 'half_day_am' | 'half_day_pm' | 'hourly' */
    unit: text("unit").notNull(),
    /** unit='hourly' の場合のみ。申請された分数 */
    minutes: integer("minutes"),
    /** 'annual' | 'stocked'。どちらの枠から消化するか */
    leaveType: text("leave_type").notNull(),
    reason: text("reason").notNull(),
    decidedBy: text("decided_by").references(() => users.id),
    decidedAt: integer("decided_at"),
    decisionNote: text("decision_note"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    index("leave_requests_tenant_user_status_idx").on(table.tenantId, table.userId, table.status),
    index("leave_requests_tenant_user_date_idx").on(table.tenantId, table.userId, table.leaveDate),
    // listApprovedLeaveRequestsInRange(queries/leave.ts)は tenant_id・user_id・status='approved'・
    // leave_date の範囲を同時に絞り込む。auto_break_waivers と同じ理由(このファイル冒頭ではなく
    // schema/auto-break-waivers.ts の同種 index に理由の詳細を書いている)で、上の2つの
    // 3カラム index だけでは4条件同時の絞り込みをカバーしきれない。GET /attendance/monthly・
    // 締め処理・打刻忘れリマインド・36協定アラートすべてがユーザーごとに呼ぶ高頻度パスのため
    // 複合 index を別途持つ。
    index("leave_requests_tenant_user_status_date_idx").on(table.tenantId, table.userId, table.status, table.leaveDate),
  ],
);
