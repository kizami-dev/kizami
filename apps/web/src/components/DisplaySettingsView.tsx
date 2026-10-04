"use client";

import { messages } from "../lib/messages";
import { useAuthGuard } from "../lib/useAuthGuard";
import { AppHeader } from "./AppHeader";
import { LanguageToggle } from "./LanguageToggle";
import { SettingsNav } from "./SettingsNav";
import { ThemeToggle } from "./ThemeToggle";

/**
 * 言語と表示の設定画面(/settings/display、2026-10-05 追加)。
 *
 * それまでヘッダー(デスクトップのユーザーメニュー・モバイルの「その他」シート)にあった
 * テーマ切り替え(`ThemeToggle`)と言語切り替え(`LanguageToggle`)をここへ移した。ヘッダーの
 * メニューは日々開く場所で、言語・配色は一度決めれば触らない設定のため、個人設定の1画面に
 * 集約する方が自然(ヘッダーのメニューもログアウトだけで済む)。
 *
 * 権限不要(本人の設定。/settings/api-keys・/settings/security と同じ扱い —
 * lib/useSettingsAccess.ts の display 参照)。保存先はサーバーではなくこのブラウザの
 * localStorage(言語 = `kizami-locale`、テーマ = `kizami-theme`)なので、API は呼ばず、
 * 別の端末・別のブラウザには引き継がれない。そのことは画面の説明文にも明記している
 * (`settingsDisplay.storageNote`)。「選んだのに別の端末で戻っている」と迷わせないため。
 *
 * 選択は即時に反映される(保存ボタンは無い)。言語を切り替えると `LocaleGate` が子ツリーを
 * 丸ごと再マウントするため、この画面の文言もその場で新しい言語になる。
 */
export function DisplaySettingsView() {
  const guard = useAuthGuard();

  if (guard.status === "loading") {
    return <p className="monthly-loading">{messages.loading}</p>;
  }
  if (guard.status === "error" || !guard.user) {
    return <p className="monthly-error">{messages.errors.network}</p>;
  }

  return (
    <div className="settings-notif">
      <AppHeader displayName={guard.user.displayName} email={guard.user.email} tenantName={guard.tenant?.name ?? null} active="settings" />
      <main className="settings-notif__main">
        <SettingsNav active="display" />
        <h1 className="settings-notif__title">{messages.settingsDisplay.title}</h1>
        <p className="settings-notif__tagline">{messages.settingsDisplay.tagline}</p>

        <section className="settings-notif__section display-settings__section" aria-labelledby="display-language-title">
          <h2 className="settings-notif__section-title" id="display-language-title">
            {messages.settingsDisplay.languageTitle}
          </h2>
          <p className="display-settings__desc">{messages.settingsDisplay.languageDesc}</p>
          <LanguageToggle />
        </section>

        <section className="settings-notif__section display-settings__section" aria-labelledby="display-theme-title">
          <h2 className="settings-notif__section-title" id="display-theme-title">
            {messages.settingsDisplay.themeTitle}
          </h2>
          <p className="display-settings__desc">{messages.settingsDisplay.themeDesc}</p>
          <ThemeToggle />
        </section>

        <p className="display-settings__note">{messages.settingsDisplay.storageNote}</p>
      </main>
    </div>
  );
}
