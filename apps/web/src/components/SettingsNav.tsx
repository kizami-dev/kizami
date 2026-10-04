"use client";

import { useEffect, useRef } from "react";
import { Link } from "waku";
import { messages } from "../lib/messages";
import { useSettingsAccess } from "../lib/useSettingsAccess";
import { visibleSettingsGroups, type SettingsSection } from "./settingsItems";

export type { SettingsSection } from "./settingsItems";

/**
 * /settings/* 画面間の行き来用ナビ。広い画面では左のサイドバー、狭い画面ではページ上部の
 * 横スクロールのタブになる(配置は components.css 側。.page の直下の最初の子に置く)。
 * 項目は「自分の設定 / 組織・権限 / 勤怠・休暇・手当 / 連携・通知 / 法令・記録」のグループに並べ、
 * 名前は設定ハブと同じ(settingsItems.tsx が出所)。アクセスできる項目だけを出す。
 */
export function SettingsNav({ active }: { active: SettingsSection }) {
  const access = useSettingsAccess();
  const navRef = useRef<HTMLElement>(null);

  // 横スクロールのタブでは、いま開いている項目が見える位置までスクロールしておく。
  useEffect(() => {
    const current = navRef.current?.querySelector<HTMLElement>('[aria-current="page"]');
    const nav = navRef.current;
    if (!current || !nav || nav.scrollWidth <= nav.clientWidth) return;
    nav.scrollLeft = Math.max(0, current.offsetLeft - nav.clientWidth / 2 + current.offsetWidth / 2);
  }, [access.loading, active]);

  if (access.loading) return null;
  const groups = visibleSettingsGroups(access);
  if (groups.length === 0) return null;

  return (
    <nav ref={navRef} className="settings-nav" aria-label={messages.settingsNav.label}>
      <Link to="/settings" className="settings-nav__hub-link">
        <span aria-hidden="true">←</span> {messages.settingsNav.hubLink}
      </Link>
      {groups.map((group) => (
        <div key={group.key} className="settings-nav__group" role="group" aria-label={group.title}>
          <p className="settings-nav__group-title" aria-hidden="true">
            {group.title}
          </p>
          <div className="settings-nav__items">
            {group.items.map((item) => (
              <Link key={item.key} to={item.to} className="settings-nav__link" aria-current={active === item.key ? "page" : undefined}>
                {item.navTitle}
              </Link>
            ))}
          </div>
        </div>
      ))}
    </nav>
  );
}
