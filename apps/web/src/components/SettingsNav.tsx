"use client";

import { Link } from "waku";
import { messages } from "../lib/messages";
import { useSettingsAccess } from "../lib/useSettingsAccess";

export type SettingsSection = "notifications" | "departments" | "members" | "presets" | "tenantProfile" | "leave";

type SettingsRoute =
  | "/settings/notifications"
  | "/settings/departments"
  | "/settings/members"
  | "/settings/presets"
  | "/settings/tenant-profile"
  | "/settings/leave";

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
    {
      key: "tenantProfile",
      to: "/settings/tenant-profile",
      label: messages.settingsNav.tenantProfile,
      enabled: access.tenantProfile,
    },
    { key: "leave", to: "/settings/leave", label: messages.settingsNav.leave, enabled: access.leave },
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
