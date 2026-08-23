/**
 * @kizami/help-content を UI から使うための薄いヘルパー。
 *
 * apps/web は @kizami/help-content の型付き辞書をそのまま利用する。存在しないキーを HelpTip に
 * 渡すとコンパイルエラーになる(@kizami/law を workspace 依存として直接 import している既存の
 * 慣行と同じ形)。
 *
 * 多言語(2026-08-24): ヘルプ本文も UI と同じ4言語(ja/en/ko/zh)を持つ。ここの各関数は
 * `locale` を省略した場合に **呼び出しのたびに** lib/i18n#getLocale() を評価する
 * (lib/messages.ts の Proxy と同じ理由 — モジュールスコープで一度だけ解決すると、
 * 言語切り替え後も最初の言語に凍結される)。実際の再描画は components/LocaleGate.tsx が
 * ロケール変更時に子ツリーを再マウントすることで起きる。
 */
import { HELP, helpEntriesFor, helpEntryFor, helpTranslationNotice, type HelpEntry, type HelpKey, type HelpLocale } from "@kizami/help-content";
import { getLocale, type Locale } from "./i18n";

export type { HelpEntry, HelpKey, HelpLocale };
export { HELP };

/**
 * UI のロケール → ヘルプ本文のロケール。
 * 値は同一(どちらも "ja" | "en" | "ko" | "zh")なので変換は不要だが、片方だけ言語が増えたときに
 * ここでコンパイルエラーになるよう、明示的な代入で対応関係を固定しておく。
 */
const localeToHelpLocale: (locale: Locale) => HelpLocale = (locale) => locale;

/**
 * VitePress の制度ガイド(docs/guide/<slug>)のベース URL。
 * apps/web/src/lib/api.ts の WAKU_PUBLIC_API_URL と同じ流儀で環境変数から上書きできる。
 *
 * 独自判断点: KIZAMI はセルフホストOSSで、VitePress サイトのデプロイ先(同一オリジンの
 * サブパスか別ホストか)は導入環境ごとに異なる。既定値は「同じリバースプロキシ配下の /docs」
 * を想定した相対パスにしておき、実際の配置に応じて WAKU_PUBLIC_DOCS_URL で上書きする前提とする。
 */
const DOCS_BASE_URL: string = import.meta.env.WAKU_PUBLIC_DOCS_URL ?? "/docs";

/**
 * ヘルプキー → VitePress 制度ガイドページの URL(scripts/sync-help-docs.mjs が生成するスラッグと一致させる)。
 *
 * リンク先は現状ロケールによらず日本語ページ。VitePress 側(docs/guide/)は
 * content/*.ja.md からのみ生成しており、多言語サイトにはなっていないため
 * (scripts/sync-help-docs.mjs のコメント参照)。ここでロケール別のパスを作ると 404 になる。
 */
export function helpDocHref(key: HelpKey): string {
  return `${DOCS_BASE_URL}/guide/${key.split(".").join("-")}`;
}

/**
 * ヘルプキー + ロケール → HelpEntry。
 * その言語の訳文が無ければ日本語へ明示的にフォールバックする(@kizami/help-content の
 * helpEntryFor。フォールバックの理由はそちらのコメント参照)。
 */
export function helpEntry(key: HelpKey, locale: Locale = getLocale()): HelpEntry {
  return helpEntryFor(key, localeToHelpLocale(locale));
}

/** 指定ロケール(既定は現在ロケール)の全エントリ。キー順。設定画面のヘルプキー一覧で使う。 */
export function helpEntries(locale: Locale = getLocale()): HelpEntry[] {
  return helpEntriesFor(localeToHelpLocale(locale));
}

/**
 * 訳文であることの注記(日本語では空文字 = 表示しない)。
 * 個々のヘルプ本文には免責を書かず、この1文だけを表示側で出す方針
 * (packages/help-content/scripts/generate.mjs の TRANSLATION_NOTICE)。
 */
export function helpNotice(locale: Locale = getLocale()): string {
  return helpTranslationNotice(localeToHelpLocale(locale));
}
