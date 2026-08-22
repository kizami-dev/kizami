"use client";

import { Link } from "waku";
import { messages } from "../lib/messages";
import { useSettingsAccess } from "../lib/useSettingsAccess";
import { useAuthGuard } from "../lib/useAuthGuard";
import { AppHeader } from "./AppHeader";

/**
 * /settings のハブ画面。アクセスできる設定項目だけをカードで表示する
 * (AppHeader の「設定」リンクの遷移先。要件: 既存の設定ナビから各画面に辿れること)。
 */
type SettingsRoute =
  | "/settings/notifications"
  | "/settings/departments"
  | "/settings/members"
  | "/settings/presets"
  | "/settings/tenant-profile"
  | "/settings/leave";

export function SettingsHubView() {
  const guard = useAuthGuard();
  const access = useSettingsAccess();

  const cards: { key: string; enabled: boolean; to: SettingsRoute; title: string; desc: string }[] = [
    {
      key: "notifications",
      enabled: access.notifications,
      to: "/settings/notifications" as const,
      title: messages.settingsHub.notificationsTitle,
      desc: messages.settingsHub.notificationsDesc,
    },
    {
      key: "departments",
      enabled: access.departments,
      to: "/settings/departments" as const,
      title: messages.settingsHub.departmentsTitle,
      desc: messages.settingsHub.departmentsDesc,
    },
    {
      key: "members",
      enabled: access.members,
      to: "/settings/members" as const,
      title: messages.settingsHub.membersTitle,
      desc: messages.settingsHub.membersDesc,
    },
    {
      key: "presets",
      enabled: access.presets,
      to: "/settings/presets" as const,
      title: messages.settingsHub.presetsTitle,
      desc: messages.settingsHub.presetsDesc,
    },
    {
      key: "tenantProfile",
      enabled: access.tenantProfile,
      to: "/settings/tenant-profile" as const,
      title: messages.settingsHub.tenantProfileTitle,
      desc: messages.settingsHub.tenantProfileDesc,
    },
    {
      key: "leave",
      enabled: access.leave,
      to: "/settings/leave" as const,
      title: messages.settingsHub.leaveTitle,
      desc: messages.settingsHub.leaveDesc,
    },
  ].filter((c) => c.enabled);

  if (guard.status === "loading" || access.loading) {
    return <p className="monthly-loading">{messages.loading}</p>;
  }
  if (guard.status === "error" || !guard.user) {
    return <p className="monthly-error">{messages.errors.network}</p>;
  }

  return (
    <div className="settings-hub">
      <AppHeader displayName={guard.user.displayName} email={guard.user.email} active="settings" />
      <main className="settings-hub__main">
        <h1 className="settings-hub__title">{messages.settingsHub.title}</h1>
        <p className="settings-hub__tagline">{messages.settingsHub.tagline}</p>

        {cards.length === 0 ? (
          <p className="settings-hub__empty">{messages.settingsHub.empty}</p>
        ) : (
          <div className="settings-hub__grid">
            {cards.map((c) => (
              <Link key={c.key} to={c.to} className="settings-hub__card">
                <span className="settings-hub__card-title">{c.title}</span>
                <span className="settings-hub__card-desc">{c.desc}</span>
              </Link>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
