/**
 * @kizami/help-content を UI から使うための薄いヘルパー。
 *
 * apps/web は @kizami/help-content の型付き辞書(HELP: Record<HelpKey, HelpEntry>)を
 * そのまま利用する。存在しないキーを HelpTip に渡すとコンパイルエラーになる
 * (@kizami/law を workspace 依存として直接 import している既存の慣行と同じ形)。
 */
import { HELP, type HelpEntry, type HelpKey } from "@kizami/help-content";

export type { HelpEntry, HelpKey };
export { HELP };

/**
 * VitePress の制度ガイド(docs/guide/<slug>)のベース URL。
 * apps/web/src/lib/api.ts の WAKU_PUBLIC_API_URL と同じ流儀で環境変数から上書きできる。
 *
 * 独自判断点: KIZAMI はセルフホストOSSで、VitePress サイトのデプロイ先(同一オリジンの
 * サブパスか別ホストか)は導入環境ごとに異なる。既定値は「同じリバースプロキシ配下の /docs」
 * を想定した相対パスにしておき、実際の配置に応じて WAKU_PUBLIC_DOCS_URL で上書きする前提とする。
 */
const DOCS_BASE_URL: string = import.meta.env.WAKU_PUBLIC_DOCS_URL ?? "/docs";

/** ヘルプキー → VitePress 制度ガイドページの URL(scripts/sync-help-docs.mjs が生成するスラッグと一致させる)。 */
export function helpDocHref(key: HelpKey): string {
  return `${DOCS_BASE_URL}/guide/${key.split(".").join("-")}`;
}

/** ヘルプキー → HelpEntry。HELP は生成物なので必ず存在する(欠落時は @kizami/help-content 側のテストで検出される)。 */
export function helpEntry(key: HelpKey): HelpEntry {
  return HELP[key];
}
