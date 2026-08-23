/**
 * 「操作は閲覧を含意する」(docs/requirements.md §4)の展開表。
 *
 * docs/design/permission-catalog.md §1 の各表「含意される閲覧権限」列をそのまま反映する。
 * 含意先がカタログの30項目キーとして存在する場合はそのキーを使う
 * (例: `attendance.punch.proxy` → `attendance.record.view`)。
 *
 * 判断点: カタログの一部の項目(部署ツリー閲覧・テナント設定閲覧・権限プリセット閲覧・
 * 実効権限ビュー閲覧・APIキー一覧閲覧)は、業務タスク権限カタログの30項目には対応する
 * 独立キーが存在しない(カタログ§2の内部リソースモデルにのみ read 操作として現れる)。
 * これらはUI上選択不可の「含意されるだけの閲覧」であるため、カタログに存在しない
 * 専用キー(`*.view` 等)をここで新規に定義して表現した。将来カタログ側に対応する
 * 独立キーが追加された場合はそちらに合わせて差し替える。
 */

import type { PermissionKey } from "./types.js";

export const IMPLIED_VIEW_PERMISSIONS: Readonly<Record<PermissionKey, readonly PermissionKey[]>> = {
  "attendance.punch.proxy": ["attendance.record.view"],
  "shift.manage": ["attendance.record.view"],
  "attendance.correction.request_for_others": ["attendance.record.view", "attendance.correction.view_all"],
  "attendance.correction.approve": ["attendance.correction.view_all", "attendance.record.view"],
  "leave.request.approve": ["leave.request.view_all", "attendance.record.view"],
  "leave.grant.manage": ["leave.balance.view"],
  "closing.execute": ["closing.view", "attendance.record.view"],
  "closing.unlock": ["closing.view", "audit_log.view"],
  "export.attendance.run": ["attendance.record.view"],
  "alert.labor_limit.configure": ["alert.labor_limit.view"],
  "member.invite": ["member.view"],
  "member.profile.edit": ["member.view"],
  "member.deactivate": ["member.view"],
  // カタログに独立キーが無いため新規定義(上記コメント参照)
  "department.manage": ["department.view"],
  "tenant_settings.calendar.manage": ["tenant_settings.view"],
  "tenant_settings.flex.manage": ["tenant_settings.view"],
  "tenant_settings.gps.manage": ["tenant_settings.view"],
  "tenant_settings.auto_deduction.manage": ["tenant_settings.view"],
  "notification.settings.manage": ["tenant_settings.view"],
  "permission.preset.manage": ["permission_preset.view"],
  "permission.assignment.manage": ["permission_preset.view", "permission_assignment.effective_view"],
  "api_key.manage": ["api_key.view"],
};
