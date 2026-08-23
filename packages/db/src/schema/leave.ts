/**
 * 有給休暇管理(§5)のテーブル群。
 *
 * - `tenant_leave_settings`: テナント単位の付与方式・時間単位年休・積立休暇の設定(1テナント1行)
 * - `leave_grants`: 有給の付与(法定自動付与・手動付与・積立への振替の3経路すべてをここに記録する)
 * - `leave_requests`: 休暇申請(correction_requests と同じ形のワークフロー: pending → approved/rejected/withdrawn)
 * - `leave_grant_proposals`: 有給付与の「予告」(予告→管理者承認→本人通知の3段フロー、v0.7)
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
    /**
     * 'auto'(法定付与の自動計算) | 'manual'(管理者による個別調整) |
     * 'conversion'(失効分の積立振替) | 'proposal'(付与予告の承認、v0.7)
     */
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

/**
 * 有給付与の「予告」(docs/design/shift-work.md 実装フェーズ4、requirements.md §11)。
 *
 * 付与基準日が近づいたユーザーについて、日次ワーカー(apps/api/src/leave-grant-proposals.ts)が
 * 「◯月◯日に◯日付与される予定」という**予告**行をここに積む。管理者が内容(特に出勤率の
 * 参考値)を確認して承認したときに初めて `leave_grants` の行が生まれる — 機械が無条件に
 * 付与を確定させない、という §11 の決定をデータ構造として表したテーブル。
 *
 * - `attendanceRate`: 出勤率の**参考値**を JSON で保存する(労基法39条1項の8割出勤要件の
 *   検算材料。最終判断は人が行う)。形は
 *   `{ periodFrom, periodTo, workingDays, attendedDays, rate, basis }`
 *   (packages/leave/src/attendance-rate.ts の AttendanceRateReference と同じ)。
 *   算出時点の値をそのまま凍結保存する(後から再計算すると、承認画面で見た数字と
 *   監査上の記録が食い違うため)。
 * - `status`: proposed → approved / rejected。`superseded` は「予告を経由せずに
 *   POST /leave/grants/auto で同じ付与が作られた」場合に予告側を無効化するための状態。
 * - `grantId`: 承認して実際に作られた `leave_grants.id`(承認前は null)。
 *
 * 判断点(一意制約): (tenant_id, user_id, leave_type, granted_on) は superseded を除いて
 * 高々1件だが、SQLite の部分 UNIQUE INDEX を drizzle スキーマに持たせると
 * マイグレーション生成の互換性(将来の PostgreSQL/D1 分離)に不確実性が残るため、
 * **クエリ層(packages/db/src/queries/leave.ts の findActiveLeaveGrantProposal)で担保**する。
 * DB 側には検索用の通常 index だけを置く(leave_grants の冪等性を listGrantedOnDates で
 * 担保しているのと同じ流儀)。
 */
export const leaveGrantProposals = sqliteTable(
  "leave_grant_proposals",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    /** 'annual' | 'stocked'(現状は法定付与のみなので 'annual') */
    leaveType: text("leave_type").notNull(),
    /** ローカル日付 "YYYY-MM-DD"。付与予定日(基準日) */
    grantedOn: text("granted_on").notNull(),
    days: integer("days").notNull(),
    /** ローカル日付 "YYYY-MM-DD"。承認時に leave_grants.expires_on へそのまま渡す */
    expiresOn: text("expires_on").notNull(),
    /** 出勤率の参考値(JSON 文字列)。上記コメント参照 */
    attendanceRate: text("attendance_rate").notNull(),
    /** 'proposed' | 'approved' | 'rejected' | 'superseded' */
    status: text("status").notNull(),
    /** UTC エポック分 */
    proposedAt: integer("proposed_at").notNull(),
    decidedBy: text("decided_by").references(() => users.id),
    decidedAt: integer("decided_at"),
    decisionNote: text("decision_note"),
    /** 承認して作成された付与。FK(leave_grants.id) */
    grantId: text("grant_id").references(() => leaveGrants.id),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    index("leave_grant_proposals_tenant_status_idx").on(table.tenantId, table.status),
    index("leave_grant_proposals_lookup_idx").on(table.tenantId, table.userId, table.leaveType, table.grantedOn),
  ],
);
