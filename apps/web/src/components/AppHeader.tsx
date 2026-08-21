"use client";

import { useEffect, useState } from "react";
import { Link, useRouter } from "waku";
import { api } from "../lib/api";
import { messages } from "../lib/messages";
import { NotificationBell } from "./NotificationBell";

export interface AppHeaderProps {
  displayName: string;
  email: string;
  active: "home" | "monthly" | "corrections" | "settings";
}

export function AppHeader({ displayName, email, active }: AppHeaderProps) {
  const router = useRouter();
  const [loggingOut, setLoggingOut] = useState(false);
  // 通知設定(/settings/notifications)の権限有無。API が 403 かどうかで判定する
  // (要件: 権限が無いユーザーにはナビにも表示しない)。判定が終わるまでは表示しない。
  const [canManageNotificationSettings, setCanManageNotificationSettings] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .getNotificationSettings()
      .then(() => {
        if (!cancelled) setCanManageNotificationSettings(true);
      })
      .catch(() => {
        // 403(権限なし)はもちろん、それ以外のエラーでも安全側に倒してリンクは出さない
        // (canManageNotificationSettings は既定 false のまま)
      });
    return () => {
      cancelled = true;
    };
  }, []);

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
        {canManageNotificationSettings ? (
          <Link
            to="/settings/notifications"
            className="k-header__navlink"
            aria-current={active === "settings" ? "page" : undefined}
          >
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
