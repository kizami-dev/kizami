/**
 * @kizami/help-content の公開API。
 *
 * 実体は scripts/generate.mjs が content/*.md から生成する src/generated.ts
 * (`pnpm --filter @kizami/help-content build` でコミット対象として再生成する)。
 * ここでは型と辞書の再輸出に加えて、ロケール解決(訳文が無いときの日本語フォールバック)だけを
 * 担う。node:fs 等のNode専用APIには一切依存しない — apps/web（ブラウザ実行）から
 * 直接 import できることがこのモジュールの制約。
 */
import { HELP, HELP_BY_LOCALE, HELP_TRANSLATION_NOTICE, type HelpEntry, type HelpKey, type HelpLocale } from "./generated.js";

export type { HelpAudience, HelpEntry, HelpKey, HelpLocale, HelpOrigin } from "./generated.js";
export {
  HELP,
  HELP_BY_LOCALE,
  HELP_KEYS,
  HELP_LOCALES,
  HELP_MISSING_KEYS,
  HELP_SOURCE_LOCALE,
  HELP_TRANSLATION_NOTICE,
} from "./generated.js";

/**
 * キー + ロケール → ヘルプエントリ。
 *
 * **フォールバックは明示的に日本語(HELP_SOURCE_LOCALE)へ落とす。**
 * 訳文が未整備のキーで undefined を返すと、呼び出し側は「ヘルプが無い」ものとして
 * 何も表示しない(あるいは空のパネルを出す)ことになる。ヘルプの中身は法令の説明なので、
 * 読み手の言語で読めないことより、読めるはずの内容が消えることの方が有害。
 * したがって「訳文が無ければ日本語をそのまま出す」を既定の挙動とする。
 *
 * 訳文の欠落自体は握りつぶさない: 生成物の HELP_MISSING_KEYS に残り、
 * packages/help-content/test/help.test.ts の完全性テストが失敗する。
 * ここでの静かなフォールバックはあくまで実行時の見え方の担保であって、翻訳漏れの許容ではない。
 */
export function helpEntryFor(key: HelpKey, locale: HelpLocale): HelpEntry {
  // HELP は HELP_BY_LOCALE[HELP_SOURCE_LOCALE] と同じ辞書だが、こちらは Partial ではない
  // Record<HelpKey, HelpEntry> なので、フォールバック先が必ず値を持つことが型で保証される。
  return HELP_BY_LOCALE[locale][key] ?? HELP[key];
}

/** 指定ロケールの全エントリ(キー順)。訳文が無いキーは日本語で埋まる(helpEntryFor と同じ規則)。 */
export function helpEntriesFor(locale: HelpLocale): HelpEntry[] {
  return (Object.keys(HELP) as HelpKey[]).map((key) => helpEntryFor(key, locale));
}

/**
 * そのロケールで表示する翻訳注記(日本語は空文字 = 表示しない)。
 * ファイルごとに免責を書かず、UI・ドキュメントのそれぞれ1箇所だけでこれを出す方針。
 */
export function helpTranslationNotice(locale: HelpLocale): string {
  return HELP_TRANSLATION_NOTICE[locale];
}
