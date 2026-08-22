"use client";

import { useState } from "react";
import { Link, useRouter } from "waku";
import { api } from "../lib/api";
import { messages } from "../lib/messages";
import { useSettingsAccess } from "../lib/useSettingsAccess";
import { KizamiMark } from "./KizamiMark";
import { NotificationBell } from "./NotificationBell";

export interface AppHeaderProps {
  displayName: string;
  email: string;
  active: "home" | "monthly" | "corrections" | "settings" | "leave";
}

export function AppHeader({ displayName, email, active }: AppHeaderProps) {
  const router = useRouter();
  const [loggingOut, setLoggingOut] = useState(false);
  // 設定サブ画面(通知/部署/メンバー/権限プリセット)へのアクセス有無。
  // いずれか1つでもアクセスできれば「設定」ナビリンクを表示する
  // (要件: 権限が無いユーザーにはナビにも表示しない)。
  // 2026-08-22: myNotifications(個人の通知設定)は誰でもアクセスできる(常に true)ため、
  // これを含めることで「設定」リンクは常に表示される — 権限を一切持たないメンバーも
  // 自分の通知の受け取り方だけは設定できる必要があるため(docs/requirements.md §7)。
  const settingsAccess = useSettingsAccess();
  const canSeeSettings =
    settingsAccess.myNotifications ||
    settingsAccess.notifications ||
    settingsAccess.departments ||
    settingsAccess.members ||
    settingsAccess.presets ||
    settingsAccess.tenantProfile ||
    settingsAccess.leave;

  async function handleLogout() {
    setLoggingOut(true);
    try {
      await api.logout();
    } finally {
      router.push("/login");
    }
  }

  return (
    <header className="k-header">
      <Link to="/" className="k-header__brand">
        <span className="k-header__mark" aria-hidden="true">
          <KizamiMark size={24} />
        </span>
        <span className="k-header__logo">{messages.appName}</span>
      </Link>
      <nav className="k-header__nav" aria-label={messages.appName}>
        <Link to="/" className="k-header__navlink" aria-current={active === "home" ? "page" : undefined}>
          {messages.nav.home}
        </Link>
        <Link to="/monthly" className="k-header__navlink" aria-current={active === "monthly" ? "page" : undefined}>
          {messages.nav.monthly}
        </Link>
        <Link
          to="/corrections"
          className="k-header__navlink"
          aria-current={active === "corrections" ? "page" : undefined}
        >
          {messages.nav.corrections}
        </Link>
        <Link to="/leave" className="k-header__navlink" aria-current={active === "leave" ? "page" : undefined}>
          {messages.nav.leave}
        </Link>
        {canSeeSettings ? (
          <Link to="/settings" className="k-header__navlink" aria-current={active === "settings" ? "page" : undefined}>
            {messages.nav.settings}
          </Link>
        ) : null}
        <NotificationBell />
        <details className="k-header__user">
          <summary>{displayName} ▾</summary>
          <div className="k-header__menu">
            <span className="k-header__menu-email">{email}</span>
            <button type="button" className="k-header__logout" onClick={handleLogout} disabled={loggingOut}>
              {messages.nav.logout}
            </button>
          </div>
        </details>
      </nav>
    </header>
  );
}
