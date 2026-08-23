import type { Decorator, Preview } from "@storybook/react";
import { LOCALE_NATIVE_NAMES, LOCALE_ORDER, type Locale, setLocale } from "../src/lib/i18n";
// 実 CSS をそのまま読み込む(_layout.tsx と同じ一覧)。「部品抽出のリファクタはしない」方針どおり、
// カタログはページ CSS に依存したまま「生きたスタイルリファレンス」として動かす。
import "../src/styles/tokens.css";
import "../src/styles/base.css";
import "../src/styles/header.css";
import "../src/styles/login.css";
import "../src/styles/dashboard.css";
import "../src/styles/onboarding.css";
import "../src/styles/punch-home.css";
import "../src/styles/monthly.css";
import "../src/styles/corrections.css";
import "../src/styles/notifications.css";
import "../src/styles/settings.css";
import "../src/styles/personal-notifications.css";
import "../src/styles/org-settings.css";
import "../src/styles/law.css";
import "../src/styles/leave.css";
import "../src/styles/help.css";
import "../src/styles/help-settings.css";
import "../src/styles/privacy-settings.css";
import "../src/styles/attendance-settings.css";
import "../src/styles/allowance-settings.css";
import "../src/styles/api-keys-settings.css";
// カタログ自体のレイアウト補助(スウォッチの並び等)。トークンのみ使い、独自の色・書体は持ち込まない。
import "../src/stories/catalog.css";

type ThemePref = "light" | "dark" | "system";

/**
 * テーマ切り替え(ThemeToggle/lib/theme.ts と同じ `data-theme` 属性の付け外し)。
 * CSS の適用だけで完結するため、レンダー中に直接 DOM へ反映すれば十分(useEffect 経由だと
 * 反映が1コミット遅れ、切り替え時に旧テーマが一瞬見えてしまう)。
 */
const withTheme: Decorator = (Story, context) => {
  const theme = context.globals.theme as ThemePref;
  if (theme === "light" || theme === "dark") {
    document.documentElement.setAttribute("data-theme", theme);
  } else {
    document.documentElement.removeAttribute("data-theme");
  }
  return <Story />;
};

/**
 * ロケール切り替え(components/LocaleGate.tsx と同じ「Fragment key で子ツリーを再マウント」
 * 手法をここで再現する)。
 *
 * LocaleGate は `setLocale` を useEffect(コミット後)で呼ぶが、それをそのままこの decorator に
 * 持ち込むと1テンポ問題が起きる: この decorator の再レンダリング(globals.locale 変化)が
 * `key` の変更として Story の unmount→remount を同じレンダーフェーズ内で引き起こすため、
 * 新しくマウントされる Story 配下のコンポーネントは「その場で(同期的に)」`messages.xxx`
 * (lib/messages.ts の Proxy)を読む。setLocale が useEffect(コミット後)発火のままだと、
 * 新しい部品ツリーの初回描画時点ではまだ `currentLocale` が更新されておらず、古い言語のまま
 * 描画されてしまう(かつ Storybook には LocaleGate の purpose である subscribeLocale の購読者が
 * いないため、その後の再描画も起きず古い言語のまま固定されてしまう)。そのため、ここでは
 * `setLocale` をレンダー本体で同期的に呼ぶ。
 */
const withLocale: Decorator = (Story, context) => {
  const locale = context.globals.locale as Locale;
  setLocale(locale);
  return <Story key={locale} />;
};

const preview: Preview = {
  decorators: [withTheme, withLocale],
  globalTypes: {
    locale: {
      name: "Locale",
      description: "kizami-locale (localStorage)",
      defaultValue: "ja" satisfies Locale,
      toolbar: {
        icon: "globe",
        items: LOCALE_ORDER.map((locale) => ({ value: locale, title: LOCALE_NATIVE_NAMES[locale] })),
        dynamicTitle: true,
      },
    },
    theme: {
      name: "Theme",
      description: "data-theme",
      defaultValue: "light" satisfies ThemePref,
      toolbar: {
        icon: "mirror",
        items: [
          { value: "light", title: "Light" },
          { value: "dark", title: "Dark" },
          { value: "system", title: "System (OS)" },
        ],
        dynamicTitle: true,
      },
    },
  },
  parameters: {
    // 背景色は tokens.css の --k-paper(ライト/ダークで自動切替)に任せる。
    // Storybook 既定の背景スウォッチャーは出さない(独自の色選択肢を持ち込まない)。
    backgrounds: { disable: true },
    layout: "fullscreen",
    options: {
      storySort: {
        order: ["Tokens", ["Colors", "Typography"], "Brand", "Primitives", "Patterns", "Docs"],
      },
    },
  },
};

export default preview;
