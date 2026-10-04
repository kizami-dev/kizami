"use client";

import { Link } from "waku";
import { messages } from "../lib/messages";
import { restartTour } from "./Tour";
import { useSettingsAccess } from "../lib/useSettingsAccess";
import { useAuthGuard } from "../lib/useAuthGuard";
import { AppHeader } from "./AppHeader";
import { SettingsItemIcon, visibleSettingsGroups, type SettingsGroup } from "./settingsItems";
import { StateView } from "./ui/StateView";
import { PageHeader } from "./ui/PageHeader";

/**
 * /settings のハブ画面。アクセスできる設定項目だけをカードで表示する
 * (AppHeader の「設定」リンクの遷移先。要件: 既存の設定ナビから各画面に辿れること)。
 * グループ分け・名前は設定ナビ(SettingsNav)と同じ(settingsItems.tsx が出所)。
 * 「自分の設定」(全員アクセス可)と「会社の設定」(権限が必要)を分け、会社の設定は
 * 組織・権限 / 勤怠・休暇・手当 / 連携・通知 / 法令・記録 の小見出しで整理する
 * (依頼: テナント設定と個人設定が混ざらないようにする)。
 */
function HubGrid({ group }: { group: SettingsGroup }) {
  return (
    <div className="settings-hub__grid">
      {group.items.map((c) => (
        <Link key={c.key} to={c.to} className="settings-hub__card">
          <span className="settings-hub__card-icon">
            <SettingsItemIcon path={c.icon} />
          </span>
          <span className="settings-hub__card-title">{c.title}</span>
          <span className="settings-hub__card-arrow" aria-hidden="true">
            →
          </span>
          <span className="settings-hub__card-desc">{c.desc}</span>
        </Link>
      ))}
    </div>
  );
}

export function SettingsHubView() {
  const guard = useAuthGuard();
  const access = useSettingsAccess();

  if (guard.status === "loading" || access.loading) {
    return <StateView kind="loading">{messages.loading}</StateView>;
  }
  if (guard.status === "error" || !guard.user) {
    return <StateView kind="error">{messages.errors.network}</StateView>;
  }

  const groups = visibleSettingsGroups(access);
  const personal = groups.find((g) => g.key === "personal");
  const tenantGroups = groups.filter((g) => g.key !== "personal");

  return (
    <div className="settings-hub">
      <AppHeader displayName={guard.user.displayName} email={guard.user.email} tenantName={guard.tenant?.name ?? null} active="settings" />
      <main className="page">
        <PageHeader title={messages.settingsHub.title} lead={messages.settingsHub.tagline} />

        {groups.length === 0 ? (
          <StateView kind="empty">{messages.settingsHub.empty}</StateView>
        ) : (
          <>
            {personal ? (
              <section className="settings-hub__group">
                <h2 className="settings-hub__group-title">{personal.title}</h2>
                <HubGrid group={personal} />
              </section>
            ) : null}

            {tenantGroups.length > 0 ? (
              <section className="settings-hub__group" data-tour="settings-hub-tenant">
                <h2 className="settings-hub__group-title">{messages.settingsHub.tenantGroupTitle}</h2>
                {tenantGroups.map((g) => (
                  <div key={g.key} className="settings-hub__subgroup">
                    <h3 className="settings-hub__subgroup-title">{g.title}</h3>
                    <HubGrid group={g} />
                  </div>
                ))}
              </section>
            ) : null}
          </>
        )}

        {/*
          使い方ツアーの再実行(2026-08-27 追加)。初回ログイン時に自動で始まるツアーを
          あとから見直すための唯一の入口。設定ハブは(個人の通知設定が全員可のため)権限に
          関わらず全員が開けるので、ここに置けばメンバーも管理者も辿り着ける。
          完了記録は端末ごと(localStorage)のため、ここから消して最初からやり直す。
        */}
        <p className="settings-hub__tour">
          <button type="button" className="settings-hub__tour-link" onClick={restartTour}>
            {messages.tour.restartTitle}
          </button>
          <span className="settings-hub__tour-desc">{messages.tour.restartDesc}</span>
        </p>
      </main>
    </div>
  );
}
