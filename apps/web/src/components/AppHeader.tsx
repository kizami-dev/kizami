"use client";

import { useState } from "react";
import { Link, useRouter } from "waku";
import { api } from "../lib/api";
import { messages } from "../lib/messages";
import { useSettingsAccess } from "../lib/useSettingsAccess";
import { NotificationBell } from "./NotificationBell";

export interface AppHeaderProps {
  displayName: string;
  email: string;
  active: "home" | "monthly" | "corrections" | "settings";
}

export function AppHeader({ displayName, email, active }: AppHeaderProps) {
  const router = useRouter();
  const [loggingOut, setLoggingOut] = useState(false);
  // 設定サブ画面(通知/部署/メンバー/権限プリセット)へのアクセス有無。
  // いずれか1つでもアクセスできれば「設定」ナビリンクを表示する
  // (要件: 権限が無いユーザーにはナビにも表示しない)。
  const settingsAccess = useSettingsAccess();
  const canSeeSettings =
    settingsAccess.notifications || settingsAccess.departments || settingsAccess.members || settingsAccess.presets;

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
        <span className="k-header__logo">{messages.appName}</span>
        <span className="k-header__tombo" aria-hidden="true">
          ✛
        </span>
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
