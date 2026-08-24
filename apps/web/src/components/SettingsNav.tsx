"use client";

import { Link } from "waku";
import { messages } from "../lib/messages";
import { useSettingsAccess } from "../lib/useSettingsAccess";

export type SettingsSection =
  | "notifications"
  | "departments"
  | "members"
  | "presets"
  | "approvalFlow"
  | "tenantProfile"
  | "leave"
  | "help"
  | "privacy"
  | "attendance"
  | "allowances"
  | "shiftPatterns"
  | "apiKeys"
  | "slack"
  | "sso"
  | "auditLogs";

type SettingsRoute =
  | "/settings/notifications"
  | "/settings/departments"
  | "/settings/members"
  | "/settings/presets"
  | "/settings/approval-flow"
  | "/settings/tenant-profile"
  | "/settings/leave"
  | "/settings/help"
  | "/settings/privacy"
  | "/settings/attendance"
  | "/settings/allowances"
  | "/settings/shift-patterns"
  | "/settings/api-keys"
  | "/settings/slack"
  | "/settings/sso"
  | "/settings/audit-logs";

/**
 * /settings/* 画面間の行き来用サブナビ(要件: 既存の設定ナビから各画面へ辿れること)。
 * アクセスできる項目のみ表示する(AppHeader と同じ判定を共有)。
 */
export function SettingsNav({ active }: { active: SettingsSection }) {
  const access = useSettingsAccess();
  if (access.loading) return null;

  const items: { key: SettingsSection; to: SettingsRoute; label: string; enabled: boolean }[] = [
    { key: "notifications", to: "/settings/notifications", label: messages.settingsNav.notifications, enabled: access.notifications },
    { key: "departments", to: "/settings/departments", label: messages.settingsNav.departments, enabled: access.departments },
    { key: "members", to: "/settings/members", label: messages.settingsNav.members, enabled: access.members },
    { key: "presets", to: "/settings/presets", label: messages.settingsNav.presets, enabled: access.presets },
    // 承認体制の設定なので、権限プリセット(誰が承認できるか)の隣に置く。
    {
      key: "approvalFlow",
      to: "/settings/approval-flow",
      label: messages.settingsNav.approvalFlow,
      enabled: access.approvalFlow,
    },
    {
      key: "attendance",
      to: "/settings/attendance",
      label: messages.settingsNav.attendance,
      enabled: access.attendance,
    },
    {
      key: "allowances",
      to: "/settings/allowances",
      label: messages.settingsNav.allowances,
      enabled: access.allowances,
    },
    {
      key: "shiftPatterns",
      to: "/settings/shift-patterns",
      label: messages.settingsNav.shiftPatterns,
      enabled: access.shiftPatterns,
    },
    {
      key: "tenantProfile",
      to: "/settings/tenant-profile",
      label: messages.settingsNav.tenantProfile,
      enabled: access.tenantProfile,
    },
    { key: "leave", to: "/settings/leave", label: messages.settingsNav.leave, enabled: access.leave },
    { key: "help", to: "/settings/help", label: messages.settingsNav.help, enabled: access.help },
    { key: "privacy", to: "/settings/privacy", label: messages.settingsNav.privacy, enabled: access.privacy },
    { key: "apiKeys", to: "/settings/api-keys", label: messages.settingsNav.apiKeys, enabled: access.apiKeys },
    { key: "slack", to: "/settings/slack", label: messages.settingsNav.slack, enabled: access.slack },
    { key: "sso", to: "/settings/sso", label: messages.settingsNav.sso, enabled: access.sso },
    { key: "auditLogs", to: "/settings/audit-logs", label: messages.settingsNav.auditLogs, enabled: access.auditLogs },
  ];
  const visible = items.filter((i) => i.enabled);
  if (visible.length === 0) return null;

  return (
    <nav className="settings-nav" aria-label={messages.settingsNav.label}>
      <Link to="/settings" className="settings-nav__hub-link">
        <span aria-hidden="true">←</span> {messages.settingsNav.hubLink}
      </Link>
      <span className="settings-nav__divider" aria-hidden="true" />
      <div className="settings-nav__tabs">
        {visible.map((item) => (
          <Link
            key={item.key}
            to={item.to}
            className="settings-nav__link"
            aria-current={active === item.key ? "page" : undefined}
          >
            {item.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}
