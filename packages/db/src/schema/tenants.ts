/**
 * tenants — テナントの不変属性 + 法令プロファイル。
 *
 * 計算に影響する設定は原則 `tenant_setting_versions` の版として管理するが、以下の3列は
 * 例外として本テーブルに直接持たせている(2026-08-22, 36協定完全版・法令パッケージ結線の依頼):
 *
 * - `is_small_or_medium_enterprise` / `is_special_provision_workplace`: `@kizami/law` の
 *   `TenantLawProfile` を組み立てる元になる、テナントの法令上の属性(企業規模・特例措置対象
 *   事業場かどうか)。`tenant_setting_versions` のような「施行日で切り替わる」性質の値ではなく、
 *   「その事業者が制度上どちらに該当するか」という比較的安定した属性であるため、
 *   effective-dated な版管理ではなく単純な現在値として持たせる(依頼で明示された設計)。
 *   変更されうる(例: 増員で特例措置対象でなくなる)ため、変更時は監査ログに残す
 *   (apps/api/src/routes/settings.ts の GET/PUT /settings/tenant-profile)。
 * - `special_clause_enabled`: 36協定の特別条項を締結しているか(テナント設定)。特別条項固有の
 *   上限(月100時間未満・複数月平均80時間・年720時間・月45時間超は年6回まで)のアラートは
 *   このフラグが true のときだけ評価する(apps/api/src/overtime-alerts.ts)。判断点: 法令プロファイル
 *   (企業規模・特例措置対象事業場)とは性質が異なる(こちらは労使協定の締結有無という運用上の
 *   選択)が、いずれも「36協定アラートの集計に直接影響するテナント設定」として同じ
 *   GET/PUT /settings/tenant-profile にまとめて置く(依頼が3つを列挙する形で依頼している
 *   ことを踏まえた判断)。
 * - `work_rules_url`: 就業規則(PDF等)へのリンク(2026-08-22、社内規定追記機能の依頼で追加)。
 *   判断点: 依頼は「tenant_documents テーブルまたは既存のテナント設定への追加」のどちらでもよいと
 *   しており、就業規則リンクは URL 1本だけの単純な現在値で、版管理も対象読者の絞り込みも不要
 *   なため、新規テーブルを起こさずこのテーブルに1列追加する(help_overrides のような
 *   テナント×キーの繰り返し構造を持たない)。GET/PUT /help/overrides・/settings/work-rules-url
 *   (apps/api/src/routes/help.ts, settings.ts)が読み書きする。
 * - `record_retention_description` / `privacy_contact_point`(2026-08-22、テナント設定編集機能
 *   で追加): 個人情報の雛形(@kizami/privacy-template)が固定文言/null で埋めていた2項目を
 *   テナントごとに設定できるようにする。判断点: どちらも「その時点の1つの現在値」であり、
 *   打刻計算に影響する effective-dated な値(原則6の対象)ではなく、`work_rules_url` と同じ
 *   性質(単純な現在値のテキスト)なのでここに直接列を追加する(新規テーブルは起こさない)。
 *   GET/PUT /settings/privacy-contact(apps/api/src/routes/settings.ts)が読み書きし、
 *   GET /settings/privacy-templates が未設定時のフォールバック(固定文言/null)付きで使う。
 *
 * 参照: docs/design/v01-data-model.md §組織・認証・権限
 */

import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const tenants = sqliteTable("tenants", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  /** 中小企業かどうか。@kizami/law の TenantLawProfile.isSmallOrMediumEnterprise に対応。既定 true */
  isSmallOrMediumEnterprise: integer("is_small_or_medium_enterprise", { mode: "boolean" }).notNull().default(true),
  /** 特例措置対象事業場かどうか。@kizami/law の TenantLawProfile.isSpecialProvisionWorkplace に対応。既定 false */
  isSpecialProvisionWorkplace: integer("is_special_provision_workplace", { mode: "boolean" }).notNull().default(false),
  /** 36協定の特別条項を締結しているか。既定 false(未締結 = 月45h/年360hが絶対上限) */
  specialClauseEnabled: integer("special_clause_enabled", { mode: "boolean" }).notNull().default(false),
  /** 就業規則(PDF等)へのリンク。未設定なら null */
  workRulesUrl: text("work_rules_url"),
  /** 打刻記録の保存期間の説明文(個人情報の雛形に使う)。未設定なら null(固定文言にフォールバック) */
  recordRetentionDescription: text("record_retention_description"),
  /** 開示・訂正等の請求を受け付ける窓口(個人情報の雛形に使う)。未設定なら null(記入例プレースホルダにフォールバック) */
  privacyContactPoint: text("privacy_contact_point"),
  /** UTC エポック分 */
  createdAt: integer("created_at").notNull(),
});
