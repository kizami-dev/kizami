import type { ReactNode } from "react";
import { messages } from "../lib/messages";
import type { SettingsAccess } from "../lib/useSettingsAccess";

/**
 * /settings/* の項目定義。設定ハブ(SettingsHubView)と設定ナビ(SettingsNav)が同じ
 * グループ分け・同じ見出し・同じ並びを使うための単一の出所。項目の名前と説明は
 * messages.settingsHub の `<key>Title` / `<key>Desc` を使う(ナビもハブと同じ名前になる)。
 */
export type SettingsSection =
  | "security"
  | "myNotifications"
  | "display"
  | "apiKeys"
  | "slackLink"
  | "departments"
  | "members"
  | "presets"
  | "approvalFlow"
  | "attendance"
  | "allowances"
  | "shiftPatterns"
  | "leave"
  | "notifications"
  | "slack"
  | "sso"
  | "tenantProfile"
  | "help"
  | "privacy"
  | "auditLogs"
  | "withdrawal";

export type SettingsRoute =
  | "/settings/security"
  | "/settings/notifications/me"
  | "/settings/display"
  | "/settings/api-keys"
  | "/settings/slack-link"
  | "/settings/departments"
  | "/settings/members"
  | "/settings/presets"
  | "/settings/approval-flow"
  | "/settings/attendance"
  | "/settings/allowances"
  | "/settings/shift-patterns"
  | "/settings/leave"
  | "/settings/notifications"
  | "/settings/slack"
  | "/settings/sso"
  | "/settings/tenant-profile"
  | "/settings/help"
  | "/settings/privacy"
  | "/settings/audit-logs"
  | "/settings/withdrawal";

export type SettingsGroupKey = "personal" | "org" | "attendance" | "integrations" | "records";

/** 「自分」以外が会社の設定(権限が必要)。 */
export const SETTINGS_GROUP_ORDER: readonly SettingsGroupKey[] = ["personal", "org", "attendance", "integrations", "records"];

export function settingsGroupTitle(group: SettingsGroupKey): string {
  const m = messages.settingsHub;
  switch (group) {
    case "personal":
      return m.personalGroupTitle;
    case "org":
      return m.groupOrgTitle;
    case "attendance":
      return m.groupAttendanceTitle;
    case "integrations":
      return m.groupIntegrationsTitle;
    case "records":
      return m.groupRecordsTitle;
  }
}

interface SettingsItemDef {
  key: SettingsSection;
  to: SettingsRoute;
  group: SettingsGroupKey;
  /** 線画アイコンの path(24x24、stroke のみ) */
  icon: string;
}

/** グループ内の並びは、この配列の順。 */
const ITEMS: readonly SettingsItemDef[] = [
  { key: "security", to: "/settings/security", group: "personal", icon: "M12 3 4.5 6v5.5c0 4.5 3 8 7.5 9.5 4.5-1.5 7.5-5 7.5-9.5V6Z M9 12l2 2 4-4" },
  { key: "myNotifications", to: "/settings/notifications/me", group: "personal", icon: "M6 9a6 6 0 0 1 12 0c0 5 2 6.5 2 6.5H4S6 14 6 9Z M10 19a2 2 0 0 0 4 0" },
  { key: "display", to: "/settings/display", group: "personal", icon: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z M3 12h18 M12 3c3 3 3 15 0 18 M12 3c-3 3-3 15 0 18" },
  { key: "apiKeys", to: "/settings/api-keys", group: "personal", icon: "M8 11a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z M11 12l9-9 M16 7l3 3 M14 9l2 2" },
  { key: "slackLink", to: "/settings/slack-link", group: "personal", icon: "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1 M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" },

  { key: "departments", to: "/settings/departments", group: "org", icon: "M9 3h6v5H9Z M3 16h6v5H3Z M15 16h6v5h-6Z M12 8v4 M6 16v-4h12v4" },
  { key: "members", to: "/settings/members", group: "org", icon: "M9 5a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6 M17 7a2.5 2.5 0 1 1 0 5 M17 14c2.5 0 4.5 2 4.5 5" },
  { key: "presets", to: "/settings/presets", group: "org", icon: "M4 7h9 M19 7h1 M4 17h1 M11 17h9 M16 5a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z M8 15a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z" },
  { key: "approvalFlow", to: "/settings/approval-flow", group: "org", icon: "M6 3.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Z M6 15.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Z M18 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Z M6 8.5v7 M8.5 6H12a3 3 0 0 1 3 3v.5" },

  { key: "attendance", to: "/settings/attendance", group: "attendance", icon: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z M12 7v5l3 2" },
  { key: "shiftPatterns", to: "/settings/shift-patterns", group: "attendance", icon: "M4 6h16v14H4Z M4 10h16 M9 3v4 M15 3v4" },
  { key: "leave", to: "/settings/leave", group: "attendance", icon: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z M12 2v2 M12 20v2 M2 12h2 M20 12h2 M5 5l1.5 1.5 M17.5 17.5 19 19 M5 19l1.5-1.5 M17.5 6.5 19 5" },
  { key: "allowances", to: "/settings/allowances", group: "attendance", icon: "M20 14.5A8 8 0 1 1 9.5 4 6.5 6.5 0 0 0 20 14.5Z" },

  { key: "notifications", to: "/settings/notifications", group: "integrations", icon: "M4 10v4h3l7 4V6l-7 4Z M18 9a4 4 0 0 1 0 6" },
  { key: "slack", to: "/settings/slack", group: "integrations", icon: "M5 5h14v10H10l-4 4v-4H5Z" },
  { key: "sso", to: "/settings/sso", group: "integrations", icon: "M5 11h14v9H5Z M8 11V8a4 4 0 0 1 8 0v3" },

  { key: "tenantProfile", to: "/settings/tenant-profile", group: "records", icon: "M5 21V4h9v17 M14 9h5v12 M3 21h18 M8 8h2 M8 12h2 M8 16h2" },
  { key: "help", to: "/settings/help", group: "records", icon: "M5 4h12a2 2 0 0 1 2 2v14H7a2 2 0 0 1-2-2Z M5 18a2 2 0 0 1 2-2h12" },
  { key: "privacy", to: "/settings/privacy", group: "records", icon: "M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12Z M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z" },
  { key: "auditLogs", to: "/settings/audit-logs", group: "records", icon: "M6 3h9l4 4v14H6Z M14 3v5h5 M9 13h7 M9 17h7" },
  // テナントの退会(2026-10-05)。保存義務・個人データの扱いと地続きなので「法令・記録」の末尾に置く。
  { key: "withdrawal", to: "/settings/withdrawal", group: "records", icon: "M4 7h16 M9 7V4h6v3 M6 7l1 13h10l1-13 M10 11v6 M14 11v6" },
];

export interface SettingsItem {
  key: SettingsSection;
  to: SettingsRoute;
  group: SettingsGroupKey;
  title: string;
  /** ナビ(サイドバー)での名前。ハブのタイトルが長い項目だけ短くする。 */
  navTitle: string;
  desc: string;
  icon: string;
}

export interface SettingsGroup {
  key: SettingsGroupKey;
  title: string;
  items: SettingsItem[];
}

/** アクセスできる項目だけを、グループごとに(空のグループは除いて)返す。 */
export function visibleSettingsGroups(access: SettingsAccess): SettingsGroup[] {
  const hub = messages.settingsHub as unknown as Record<string, string>;
  return SETTINGS_GROUP_ORDER.map((group) => ({
    key: group,
    title: settingsGroupTitle(group),
    items: ITEMS.filter((i) => i.group === group && access[i.key]).map((i) => ({
      key: i.key,
      to: i.to,
      group: i.group,
      title: hub[`${i.key}Title`] ?? i.key,
      navTitle: hub[`${i.key}NavTitle`] ?? hub[`${i.key}Title`] ?? i.key,
      desc: hub[`${i.key}Desc`] ?? "",
      icon: i.icon,
    })),
  })).filter((g) => g.items.length > 0);
}

/** 設定項目の線画アイコン(currentColor、NavIcons と同じ太さ)。 */
export function SettingsItemIcon({ path, size = 22 }: { path: string; size?: number }): ReactNode {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" focusable="false">
      <path d={path} stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
