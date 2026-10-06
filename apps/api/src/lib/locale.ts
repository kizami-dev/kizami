/**
 * ユーザーの表示言語(ロケール)の定義と検証(2026-10-07、システムメールの多言語化)。
 *
 * 値は Web の `Locale`(apps/web/src/lib/i18n/index.ts)と同一の綴り。api と web は別パッケージで
 * 共有の置き場が無い(packages/ に i18n 用のものは作らない — 5つの文字列のためだけに依存を足さない)
 * ので、api 側にも定数を持ち、`test/locale.test.ts` が web の `LOCALE_ORDER` と一致することを
 * 検証して**ズレを CI で検出**する。
 *
 * 判断点: 検証は「許可リストと完全一致」だけ。`en-US` のような BCP47 の揺れは受けない — 値の出所は
 * Web の `LOCALE_ORDER` の要素だけで、揺れを許すとリクエストごとに正規化の解釈が割れる。
 * 不正値は 400 にせず**無視して次の候補へ**落とす用途(未認証のメール)と、400 で返す用途
 * (本人の設定 PUT /me/locale)の両方があるので、`parseLocale` は null を返すだけにして呼び出し側が選ぶ。
 */

export const SUPPORTED_LOCALES = ["ja", "en", "ko", "zh", "zh-Hant"] as const;

export type Locale = (typeof SUPPORTED_LOCALES)[number];

/** ロケールが不明なときの既定(システムメールは従来どおり日本語)。 */
export const DEFAULT_LOCALE: Locale = "ja";

/** 許可リストに完全一致する文字列だけを Locale として返す。それ以外(型違い・未知の値)は null。 */
export function parseLocale(value: unknown): Locale | null {
  return typeof value === "string" && (SUPPORTED_LOCALES as readonly string[]).includes(value) ? (value as Locale) : null;
}

/**
 * 候補を左から見て、最初に有効なロケールを返す(無ければ既定の ja)。
 * 例: 再設定メール = `resolveLocale(リクエストの locale, そのアカウントの users.locale)`。
 */
export function resolveLocale(...candidates: unknown[]): Locale {
  for (const candidate of candidates) {
    const parsed = parseLocale(candidate);
    if (parsed) return parsed;
  }
  return DEFAULT_LOCALE;
}
