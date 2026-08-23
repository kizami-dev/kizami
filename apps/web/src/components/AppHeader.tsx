"use client";

import { useEffect, useRef, useState } from "react";
import { Link, useRouter } from "waku";
import { api } from "../lib/api";
import { messages } from "../lib/messages";
import { useSettingsAccess } from "../lib/useSettingsAccess";
import { CorrectionsTabIcon, MonthlyTabIcon, MoreTabIcon, PunchTabIcon } from "./NavIcons";
import { KizamiMark } from "./KizamiMark";
import { LanguageToggle } from "./LanguageToggle";
import { NotificationBell } from "./NotificationBell";
import { ThemeToggle } from "./ThemeToggle";

/**
 * "notifications"(通知一覧画面、2026-08-22 追加)はどのタブ・デスクトップナビにも対応させない
 * (dashboard と同じ扱い — ベル・「その他」シートからだけ辿り着く二次的な画面のため)。
 */
export type AppHeaderActive = "dashboard" | "punch" | "monthly" | "corrections" | "settings" | "leave" | "notifications";

export interface AppHeaderProps {
  displayName: string;
  email: string;
  /** テナント名(社名、2026-08-23 追加)。GET /me が返す値をそのまま渡す。未設定(null)なら何も表示しない。 */
  tenantName: string | null;
  active: AppHeaderActive;
}

/** 下部タブバーの4つの枠のうち、現在どれを選択状態にするか。「有給」「設定」は「その他」に畳む。 */
type TabKey = "punch" | "monthly" | "corrections" | "other";

function tabForActive(active: AppHeaderActive): TabKey | null {
  if (active === "punch") return "punch";
  if (active === "monthly") return "monthly";
  if (active === "corrections") return "corrections";
  if (active === "leave" || active === "settings") return "other";
  return null; // dashboard はロゴタップで戻る場所のため、タブには対応させない
}

/**
 * 全画面共通ヘッダー(2026-08-22 作り直し)。
 *
 * デスクトップ(641px〜)は従来どおり横並びナビ+ユーザーメニュー。
 * モバイル(〜640px)はロゴ+通知ベルだけの薄いヘッダーにし、ナビは下部固定タブバーへ、
 * ユーザーメニュー(テーマ切り替え・ログアウト含む)は「その他」シートへ移す
 * (要件: 390px 幅でナビが2行に折り返しユーザーメニューが画面外にはみ出す問題の解消)。
 * 表示の出し分けは CSS のメディアクエリのみで行い、両方を常に DOM に置く
 * (JS 分岐で二重にコンポーネントを持たない=通知ベルのポーリングが二重化しない)。
 */
export function AppHeader({ displayName, email, tenantName, active }: AppHeaderProps) {
  const router = useRouter();
  const [loggingOut, setLoggingOut] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const sheetRef = useRef<HTMLDivElement>(null);

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

  const activeTab = tabForActive(active);

  useEffect(() => {
    if (!sheetOpen) return;
    function handleClickOutside(e: MouseEvent) {
      if (sheetRef.current && !sheetRef.current.contains(e.target as Node)) {
        setSheetOpen(false);
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setSheetOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [sheetOpen]);

  async function handleLogout() {
    setLoggingOut(true);
    try {
      await api.logout();
    } finally {
      setSheetOpen(false);
      router.push("/login");
    }
  }

  function handleOpenNotifications() {
    setSheetOpen(false);
    document.getElementById("notif-bell-trigger")?.click();
  }

  return (
    <>
      <header className="k-header">
        {/* テナント名(社名、2026-08-23 追加): ロゴの隣に区切り線+控えめな色で出す。
            長い社名は省略(CSS 側で max-width + ellipsis)。null(未設定)なら区切りごと出さない。
            モバイルではヘッダー幅が足りないため CSS で隠し、代わりに「その他」シートの先頭に出す
            (下記 more-sheet__header 参照)。 */}
        <div className="k-header__brand-group">
          <Link to="/" className="k-header__brand">
            <span className="k-header__mark" aria-hidden="true">
              <KizamiMark size={24} />
            </span>
            <span className="k-header__logo">{messages.appName}</span>
          </Link>
          {tenantName ? (
            <span className="k-header__tenant" title={tenantName}>
              <span className="k-header__tenant-divider" aria-hidden="true" />
              <span className="k-header__tenant-name" aria-label={`${messages.header.tenantAriaLabel}: ${tenantName}`}>
                {tenantName}
              </span>
            </span>
          ) : null}
        </div>

        {/* デスクトップのみ表示(CSS でモバイル時 display:none)。 */}
        <nav className="k-header__nav" aria-label={messages.appName}>
          <Link to="/" className="k-header__navlink" aria-current={active === "dashboard" ? "page" : undefined}>
            {messages.nav.dashboard}
          </Link>
          <Link to="/punch" className="k-header__navlink" aria-current={active === "punch" ? "page" : undefined}>
            {messages.nav.punch}
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
        </nav>

        <div className="k-header__actions">
          <NotificationBell />
          {/* デスクトップのみ表示(CSS でモバイル時 display:none)。中身はモバイルでは「その他」シートへ。 */}
          <details className="k-header__user">
            <summary>{displayName} ▾</summary>
            <div className="k-header__menu">
              <span className="k-header__menu-email">{email}</span>
              <ThemeToggle />
              <LanguageToggle />
              <button type="button" className="k-header__logout" onClick={handleLogout} disabled={loggingOut}>
                {messages.nav.logout}
              </button>
            </div>
          </details>
        </div>
      </header>

      {/* モバイルのみ表示(CSS でデスクトップ時 display:none)。 */}
      <nav className="k-tabbar" aria-label={messages.appName}>
        <Link
          to="/punch"
          className="k-tabbar__item"
          aria-current={activeTab === "punch" ? "page" : undefined}
          onClick={() => setSheetOpen(false)}
        >
          <PunchTabIcon className="k-tabbar__icon" />
          <span className="k-tabbar__label">{messages.nav.punch}</span>
        </Link>
        <Link
          to="/monthly"
          className="k-tabbar__item"
          aria-current={activeTab === "monthly" ? "page" : undefined}
          onClick={() => setSheetOpen(false)}
        >
          <MonthlyTabIcon className="k-tabbar__icon" />
          <span className="k-tabbar__label">{messages.nav.monthly}</span>
        </Link>
        <Link
          to="/corrections"
          className="k-tabbar__item"
          aria-current={activeTab === "corrections" ? "page" : undefined}
          onClick={() => setSheetOpen(false)}
        >
          <CorrectionsTabIcon className="k-tabbar__icon" />
          <span className="k-tabbar__label">{messages.nav.corrections}</span>
        </Link>
        <button
          type="button"
          className="k-tabbar__item k-tabbar__item--button"
          aria-haspopup="dialog"
          aria-expanded={sheetOpen}
          aria-current={activeTab === "other" ? "page" : undefined}
          onClick={() => setSheetOpen((v) => !v)}
        >
          <MoreTabIcon className="k-tabbar__icon" />
          <span className="k-tabbar__label">{messages.mobileNav.more}</span>
        </button>
      </nav>

      {sheetOpen ? (
        <div className="more-sheet__backdrop">
          <div
            className="more-sheet"
            ref={sheetRef}
            role="dialog"
            aria-modal="true"
            aria-label={messages.mobileNav.sheetTitle}
          >
            <div className="more-sheet__handle" aria-hidden="true" />
            <div className="more-sheet__header">
              {/* テナント名(社名、2026-08-23 追加): モバイルはヘッダー本体に入らないため、
                  デスクトップの「ユーザーメニュー」に相当するこのシートの先頭に出す。 */}
              {tenantName ? (
                <span className="more-sheet__tenant" title={tenantName}>
                  {tenantName}
                </span>
              ) : null}
              <span className="more-sheet__name">{displayName}</span>
              <span className="more-sheet__email">{email}</span>
              <button
                type="button"
                className="more-sheet__close"
                onClick={() => setSheetOpen(false)}
                aria-label={messages.mobileNav.close}
              >
                ×
              </button>
            </div>

            <div className="more-sheet__body">
              <Link to="/leave" className="more-sheet__row" onClick={() => setSheetOpen(false)}>
                {messages.nav.leave}
              </Link>
              {canSeeSettings ? (
                <Link to="/settings" className="more-sheet__row" onClick={() => setSheetOpen(false)}>
                  {messages.nav.settings}
                </Link>
              ) : null}
              <button type="button" className="more-sheet__row more-sheet__row--button" onClick={handleOpenNotifications}>
                {messages.mobileNav.openNotifications}
              </button>
              <Link to="/notifications" className="more-sheet__row" onClick={() => setSheetOpen(false)}>
                {messages.mobileNav.allNotifications}
              </Link>

              <div className="more-sheet__theme">
                <ThemeToggle />
              </div>
              <div className="more-sheet__language">
                <LanguageToggle />
              </div>

              <button
                type="button"
                className="more-sheet__row more-sheet__row--logout"
                onClick={handleLogout}
                disabled={loggingOut}
              >
                {messages.nav.logout}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
