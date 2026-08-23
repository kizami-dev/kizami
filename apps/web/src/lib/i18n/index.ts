/**
 * UI の多言語対応(2026-08-23 追加、日本語・英語・韓国語・簡体中文の4言語)。
 *
 * 設計:
 * - `Messages` 型は `ja`(既定ロケール)から導出する。他ロケール(en/ko/zh)は
 *   `satisfies Messages` でこの型を満たす形で定義し、キーの過不足をコンパイルエラーに
 *   する(翻訳漏れ・キー名のズレを構造的に防ぐ。ここが今回の最重要の設計判断)。
 * - ロケールの決定は localStorage(`LOCALE_STORAGE_KEY`)→ 無ければ `navigator.language` から
 *   推定 → 既定 "ja"。推定結果(navigator.language 由来)は保存しない(次回訪問時も
 *   ブラウザの言語設定が変わっていれば再判定できるようにするため。localStorage に保存するのは
 *   ユーザーが明示的に切り替えたときだけ)。
 * - リアクティブ化は `lib/theme.ts`(ThemeToggle)と同じ流儀は取らない。テーマは CSS の
 *   `data-theme` 属性だけで完結するため React の再レンダリングが不要だが、言語切り替えは
 *   実際の文字列(JSX のテキストノード)を差し替える必要があり、CSS だけでは実現できない。
 *   そのため、モジュールスコープの単純な pub/sub ストア(`currentLocale` + `listeners`)を持ち、
 *   `components/LocaleGate.tsx` がこれを購読して `<Fragment key={locale}>` で子ツリーを
 *   丸ごと再マウントする。既存の `import { messages } from "../lib/messages"` を書き換えずに
 *   すべての利用箇所へ新しい言語を反映させるための仕組み(詳細は messages.ts のコメント参照)。
 * - 初期表示は静的書き出し(`getConfig: { render: "static" }`)のため常に日本語で焼き込まれる。
 *   `LocaleGate` はハイドレーション後の useEffect で実際のロケールに同期する
 *   (ThemeToggle が「サーバー描画時点では "system" 固定でよい」としているのと同じ考え方)。
 *   非日本語ユーザーの初回表示では一瞬日本語→目的の言語に切り替わるちらつきが発生しうるが、
 *   静的書き出しである以上避けられないトレードオフとして許容する。
 */
import { en } from "./en";
import { ja } from "./ja";
import { ko } from "./ko";
import { zh } from "./zh";

export type Messages = typeof ja;
export type Locale = "ja" | "en" | "ko" | "zh";

export const LOCALE_STORAGE_KEY = "kizami-locale";

/** 言語切り替え UI(LanguageToggle)に表示する順序。 */
export const LOCALE_ORDER: readonly Locale[] = ["ja", "en", "ko", "zh"];

/** 各言語の自称。ロケールに関わらず常にこの表記で出す(要件どおり)。 */
export const LOCALE_NATIVE_NAMES: Record<Locale, string> = {
  ja: "日本語",
  en: "English",
  ko: "한국어",
  zh: "简体中文",
};

/** `<html lang>` に設定する BCP47 タグ。 */
const HTML_LANG: Record<Locale, string> = {
  ja: "ja",
  en: "en",
  ko: "ko",
  zh: "zh-Hans",
};

/** `Intl.DateTimeFormat` 等に渡す BCP47 ロケールタグ(PunchHome の大時計表示用)。 */
export const INTL_LOCALE: Record<Locale, string> = {
  ja: "ja-JP",
  en: "en-US",
  ko: "ko-KR",
  zh: "zh-Hans-CN",
};

const DICTIONARIES: Record<Locale, Messages> = { ja, en, ko, zh };

const VALID_LOCALES: readonly string[] = LOCALE_ORDER;

function isLocale(value: string | null | undefined): value is Locale {
  return value !== null && value !== undefined && VALID_LOCALES.includes(value);
}

/** navigator.language(例: "en-US", "zh-CN")→ サポートするロケールへの粗いマッピング。 */
function localeFromLanguageTag(tag: string): Locale | null {
  const lower = tag.toLowerCase();
  if (lower.startsWith("ja")) return "ja";
  if (lower.startsWith("ko")) return "ko";
  if (lower.startsWith("zh")) return "zh";
  if (lower.startsWith("en")) return "en";
  return null;
}

/** ブラウザの言語設定から推定する(見つからなければ既定の "ja")。 */
export function detectLocale(): Locale {
  if (typeof navigator === "undefined") return "ja";
  const candidates =
    navigator.languages && navigator.languages.length > 0 ? navigator.languages : [navigator.language];
  for (const tag of candidates) {
    if (!tag) continue;
    const matched = localeFromLanguageTag(tag);
    if (matched) return matched;
  }
  return "ja";
}

/** localStorage に保存されている明示的な選択(無ければ null)。 */
export function readStoredLocale(): Locale | null {
  if (typeof window === "undefined") return null;
  try {
    const v = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    return isLocale(v) ? v : null;
  } catch {
    // プライベートモード等 localStorage が使えない環境では未設定として扱う。
    return null;
  }
}

/** localStorage → navigator.language → "ja" の優先順で初期ロケールを解決する。 */
export function resolveInitialLocale(): Locale {
  return readStoredLocale() ?? detectLocale();
}

let currentLocale: Locale = "ja";
const listeners = new Set<() => void>();

/** 現在のロケール(モジュールスコープの単一の真実)。 */
export function getLocale(): Locale {
  return currentLocale;
}

/** 現在のロケールの辞書。lib/messages.ts の Proxy・lib/time.ts から参照する。 */
export function getMessages(): Messages {
  return DICTIONARIES[currentLocale];
}

/** ロケール変更の購読(LocaleGate 専用)。戻り値の関数で解除する。 */
export function subscribeLocale(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function applyHtmlLang(locale: Locale): void {
  if (typeof document === "undefined") return;
  document.documentElement.lang = HTML_LANG[locale];
}

function applyLocale(locale: Locale, persist: boolean): void {
  currentLocale = locale;
  applyHtmlLang(locale);
  if (persist && typeof window !== "undefined") {
    try {
      window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
    } catch {
      // 保存できなくても表示自体は続行する(このセッション内は動作する)。
    }
  }
  for (const listener of listeners) listener();
}

/**
 * 起動時の初期化。`LocaleGate` のマウント時に一度だけ呼ぶ。
 * navigator.language からの推定結果は保存しない(readStoredLocale が優先されるのは
 * ユーザーが一度でも明示的に選んだ場合のみ)。
 */
export function initLocale(): Locale {
  const resolved = resolveInitialLocale();
  applyLocale(resolved, false);
  return resolved;
}

/** ユーザー操作による切り替え(LanguageToggle から呼ぶ)。常に localStorage へ保存する。 */
export function setLocale(locale: Locale): void {
  applyLocale(locale, true);
}
