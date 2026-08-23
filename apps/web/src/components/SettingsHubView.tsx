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
  | "/settings/notifications/me"
  | "/settings/notifications"
  | "/settings/departments"
  | "/settings/members"
  | "/settings/presets"
  | "/settings/tenant-profile"
  | "/settings/leave"
  | "/settings/help"
  | "/settings/privacy"
  | "/settings/attendance"
  | "/settings/allowances"
  | "/settings/api-keys"
  | "/settings/slack"
  | "/settings/slack-link"
  | "/settings/audit-logs";

export function SettingsHubView() {
  const guard = useAuthGuard();
  const access = useSettingsAccess();

  // 「自分の設定」(全員アクセス可)と「会社の設定」(権限が必要)をカード群として分ける
  // (依頼: テナント設定と個人設定が混ざらないようにする)。
  const personalCards: { key: string; enabled: boolean; to: SettingsRoute; title: string; desc: string }[] = [
    {
      key: "myNotifications",
      enabled: access.myNotifications,
      to: "/settings/notifications/me" as const,
      title: messages.settingsHub.myNotificationsTitle,
      desc: messages.settingsHub.myNotificationsDesc,
    },
    {
      key: "apiKeys",
      enabled: access.apiKeys,
      to: "/settings/api-keys" as const,
      title: messages.settingsHub.apiKeysTitle,
      desc: messages.settingsHub.apiKeysDesc,
    },
    {
      key: "slackLink",
      enabled: access.slackLink,
      to: "/settings/slack-link" as const,
      title: messages.settingsHub.slackLinkTitle,
      desc: messages.settingsHub.slackLinkDesc,
    },
  ].filter((c) => c.enabled);

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
      key: "attendance",
      enabled: access.attendance,
      to: "/settings/attendance" as const,
      title: messages.settingsHub.attendanceTitle,
      desc: messages.settingsHub.attendanceDesc,
    },
    {
      key: "allowances",
      enabled: access.allowances,
      to: "/settings/allowances" as const,
      title: messages.settingsHub.allowancesTitle,
      desc: messages.settingsHub.allowancesDesc,
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
    {
      key: "help",
      enabled: access.help,
      to: "/settings/help" as const,
      title: messages.settingsHub.helpTitle,
      desc: messages.settingsHub.helpDesc,
    },
    {
      key: "privacy",
      enabled: access.privacy,
      to: "/settings/privacy" as const,
      title: messages.settingsHub.privacyTitle,
      desc: messages.settingsHub.privacyDesc,
    },
    {
      key: "slack",
      enabled: access.slack,
      to: "/settings/slack" as const,
      title: messages.settingsHub.slackTitle,
      desc: messages.settingsHub.slackDesc,
    },
    {
      key: "auditLogs",
      enabled: access.auditLogs,
      to: "/settings/audit-logs" as const,
      title: messages.settingsHub.auditLogsTitle,
      desc: messages.settingsHub.auditLogsDesc,
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
      <AppHeader displayName={guard.user.displayName} email={guard.user.email} tenantName={guard.tenant?.name ?? null} active="settings" />
      <main className="settings-hub__main">
        <h1 className="settings-hub__title">{messages.settingsHub.title}</h1>
        <p className="settings-hub__tagline">{messages.settingsHub.tagline}</p>

        {personalCards.length === 0 && cards.length === 0 ? (
          <p className="settings-hub__empty">{messages.settingsHub.empty}</p>
        ) : (
          <>
            {personalCards.length > 0 ? (
              <section className="settings-hub__group">
                <h2 className="settings-hub__group-title">{messages.settingsHub.personalGroupTitle}</h2>
                <div className="settings-hub__grid">
                  {personalCards.map((c) => (
                    <Link key={c.key} to={c.to} className="settings-hub__card">
                      <span className="settings-hub__card-title">{c.title}</span>
                      <span className="settings-hub__card-desc">{c.desc}</span>
                    </Link>
                  ))}
                </div>
              </section>
            ) : null}

            {cards.length > 0 ? (
              <section className="settings-hub__group">
                <h2 className="settings-hub__group-title">{messages.settingsHub.tenantGroupTitle}</h2>
                <div className="settings-hub__grid">
                  {cards.map((c) => (
                    <Link key={c.key} to={c.to} className="settings-hub__card">
                      <span className="settings-hub__card-title">{c.title}</span>
                      <span className="settings-hub__card-desc">{c.desc}</span>
                    </Link>
                  ))}
                </div>
              </section>
            ) : null}
          </>
        )}
      </main>
    </div>
  );
}
