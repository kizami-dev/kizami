"use client";

import { useState } from "react";
import { Link, useRouter } from "waku";
import { api } from "../lib/api";
import { messages } from "../lib/messages";

export interface AppHeaderProps {
  displayName: string;
  email: string;
  active: "home" | "monthly";
}

export function AppHeader({ displayName, email, active }: AppHeaderProps) {
  const router = useRouter();
  const [loggingOut, setLoggingOut] = useState(false);

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
