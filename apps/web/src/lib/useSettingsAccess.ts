"use client";

import type { Scope } from "./api";
import { hasEffectivePermission } from "./permissions";
import { useEffectivePermissions } from "./useEffectivePermissions";

export interface SettingsAccess {
  loading: boolean;
  /**
   * /settings/notifications/me(個人の通知設定)。自分用なので権限不要 — 認証済みなら誰でも
   * 自分の受け取り方を設定できるため、常に true。テナント設定(notifications, 下記)とは
   * 完全に独立して常に表示する(docs/requirements.md §7「通知設定の2層構造」)。
   */
  myNotifications: boolean;
  notifications: boolean;
  departments: boolean;
  members: boolean;
  presets: boolean;
  tenantProfile: boolean;
  leave: boolean;
  help: boolean;
  privacy: boolean;
  attendance: boolean;
  allowances: boolean;
  /** /settings/api-keys。自分のキーの発行・一覧・失効は全認証済みユーザーが行えるため、常に true。 */
  apiKeys: boolean;
  slack: boolean;
  /** /settings/sso(SSO(OIDC)設定、2026-08-24 追加)。tenant_settings.auth.manage(tenant スコープ)。 */
  sso: boolean;
  /** /settings/slack-link。apiKeys と同じく自分用なので権限不要、常に true。 */
  slackLink: boolean;
  /** /settings/audit-logs(Tier 1 新設)。audit_log.view(department スコープ以上)。 */
  auditLogs: boolean;
  /** /settings/shift-patterns(v0.7 フェーズ3、2026-08-24 追加)。shift.manage(tenant スコープ)。 */
  shiftPatterns: boolean;
}

/**
 * 設定サブナビ(AppHeader・SettingsNav・設定ハブ)がどの /settings/* を表示してよいかを判定する。
 *
 * 2026-08-23 レビュー第2波: 従来は apps/api に「自分の実効権限一覧」を返すエンドポイントが無く、
 * 各画面の一覧 API を10本並列で叩いて 200/403 で判定していた(失敗時は安全側=非表示)。
 * GET /me/effective-permissions の新設により、その場しのぎのプローブ方式を全廃し、
 * 「権限キー → この画面が要求する権限」の対応表を引くだけの判定に置き換える。
 *
 * 判断点(完了報告に明記): 対応表は apps/api/src/routes/settings.ts・departments.ts・
 * members.ts・presets.ts・help.ts が実際に requirePermission へ渡している権限キー・スコープを
 * 正とし、そのまま転記した(推測ではない)。
 * - notifications: NOTIFICATION_SETTINGS_PERMISSION = "notification.settings.manage" (tenant)
 * - departments: GET /departments は "department.manage"(department_and_descendants)または
 *   フォールバックの "member.view"(department)のどちらかで通る(departments.ts の
 *   MANAGE_PERMISSION/VIEW_FALLBACK_PERMISSION 参照)
 * - members: GET /members の VIEW_PERMISSION = "member.view" (department)
 * - presets: PRESET_MANAGE_PERMISSION = "permission.preset.manage" (tenant)
 * - tenantProfile: TENANT_PROFILE_PERMISSION = "alert.labor_limit.configure" (tenant)
 * - leave: LEAVE_SETTINGS_PERMISSION = "leave.grant.manage" (tenant)
 * - help / privacy / slack: いずれも settings.ts 内で NOTIFICATION_SETTINGS_PERMISSION
 *   (= HELP_OVERRIDES_PERMISSION と同じ "notification.settings.manage")を転用している定数
 *   (WORK_RULES_URL_PERMISSION・PRIVACY_TEMPLATES_PERMISSION・SLACK_SETTINGS_PERMISSION)を
 *   そのまま使うため、notifications と同じ権限キーで判定する
 * - attendance: ATTENDANCE_CALENDAR_PERMISSION = "tenant_settings.calendar.manage" または
 *   WORK_POLICY_PERMISSION = "tenant_settings.flex.manage" のどちらか(tenant)。どちらか一方でも
 *   持っていれば画面自体は表示する(画面側は各セクションを個別に出し分ける、従来と同じ方針)
 * - allowances: ALLOWANCE_SETTINGS_PERMISSION = ATTENDANCE_CALENDAR_PERMISSION と同一
 *   ("tenant_settings.calendar.manage"、tenant)
 * - auditLogs: apps/api/src/routes/audit-logs.ts の VIEW_PERMISSION = "audit_log.view"
 *   (department スコープ以上、docs/design/permission-catalog.md §1.13。危険フラグあり)
 */
export function useSettingsAccess(): SettingsAccess {
  const { loading, permissions } = useEffectivePermissions();

  function has(key: string, minScope: Scope): boolean {
    return hasEffectivePermission(permissions, key, minScope);
  }

  return {
    loading,
    myNotifications: true,
    apiKeys: true,
    slackLink: true,
    notifications: has("notification.settings.manage", "tenant"),
    departments: has("department.manage", "department_and_descendants") || has("member.view", "department"),
    members: has("member.view", "department"),
    presets: has("permission.preset.manage", "tenant"),
    tenantProfile: has("alert.labor_limit.configure", "tenant"),
    leave: has("leave.grant.manage", "tenant"),
    help: has("notification.settings.manage", "tenant"),
    privacy: has("notification.settings.manage", "tenant"),
    attendance: has("tenant_settings.calendar.manage", "tenant") || has("tenant_settings.flex.manage", "tenant"),
    allowances: has("tenant_settings.calendar.manage", "tenant"),
    slack: has("notification.settings.manage", "tenant"),
    // routes/settings/sso.ts が GET/PUT とも SSO_SETTINGS_PERMISSION
    // (= "tenant_settings.auth.manage")を tenant スコープで要求する。通知設定とは別キー
    // (理由は routes/settings/permissions.ts の定数コメント参照)。
    sso: has("tenant_settings.auth.manage", "tenant"),
    auditLogs: has("audit_log.view", "department"),
    // shift-patterns.ts が GET/POST/:id/archive すべてで SHIFT_MANAGE_PERMISSION を tenant
    // スコープで要求する(routes/settings/shift-patterns.ts 冒頭コメント参照)ため、それに揃える。
    shiftPatterns: has("shift.manage", "tenant"),
  };
}
