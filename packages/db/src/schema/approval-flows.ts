/**
 * approval_flow_settings — 多段承認(2段承認)のテナント単位設定。
 * 設計の正: docs/design/approval-flows.md
 *
 * 対象は「その種別の承認権限をスコープ内で持つ人が1回 approve すれば反映される」形の
 * 3種類の申請(打刻修正 / 休暇 / 休憩自動控除の打ち消し)。既定はすべて単段(1)で、
 * テナントが種別ごとに 2 を選ぶと二段承認になる。
 *
 * なぜ `tenant_setting_versions`(実効日付き版管理)に相乗りしないか(判断点):
 * tenant_setting_versions は**集計結果に影響する設定**(日界・法定休日・休憩ルール・GPS)を
 * 「いつ時点の設定で計算したか」を後から再現できるように実効日付きで持つテーブルである。
 * 承認フローの段数は集計に一切影響しない(承認された結果が同じなら勤怠の数字は同じ)ため、
 * 実効日で遡って引き直す必要がない。よって `tenant_oidc_settings` / `tenant_slack_settings` と
 * 同じ「1テナント1行・丸ごと置き換え・変更は監査ログに残す」という単純な形にそろえる。
 *
 * 種別ごとに行を持つ形(type カラム + steps)ではなく1行3カラムにしたのも同じ理由で、
 * 対象の3種別は権限カタログ上も固定であり、増減するのは KIZAMI 自身のリリース時だけ
 * (テナントが種別を増やせるわけではない)。1行にしておけば「テナントの承認フロー設定」を
 * 1回の SELECT で読めて、既定値の扱いも列の DEFAULT だけで済む。
 *
 * 仕掛かり中の申請(グランドファザリング)の扱いはこのテーブルには現れない。各申請テーブルの
 * `required_steps` 列に**作成時点の段数を凍結して保存**する(schema/corrections.ts 等の
 * コメント参照)。設定を後から変えても、既に出ている申請の段数は変わらない。
 */

import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { tenants } from "./tenants.js";
import { users } from "./users.js";

export const approvalFlowSettings = sqliteTable("approval_flow_settings", {
  tenantId: text("tenant_id")
    .primaryKey()
    .references(() => tenants.id),
  /** 打刻修正申請(correction_requests)の承認段数。1 = 単段(既定)/ 2 = 二段 */
  correctionSteps: integer("correction_steps").notNull().default(1),
  /** 休暇申請(leave_requests)の承認段数。1 = 単段(既定)/ 2 = 二段 */
  leaveSteps: integer("leave_steps").notNull().default(1),
  /** 休憩自動控除の打ち消し申請(auto_break_waivers)の承認段数。1 = 単段(既定)/ 2 = 二段 */
  autoBreakWaiverSteps: integer("auto_break_waiver_steps").notNull().default(1),
  /** UTC エポック分 */
  updatedAt: integer("updated_at").notNull(),
  updatedBy: text("updated_by")
    .notNull()
    .references(() => users.id),
});
