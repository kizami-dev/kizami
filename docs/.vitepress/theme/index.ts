import DefaultTheme from "vitepress/theme";
import "./custom.css";

/**
 * デフォルトテーマに、制度ガイド(docs/guide/)の出所バッジ用CSSだけを足す最小カスタマイズ。
 * scripts/sync-help-docs.mjs が各ページ先頭に埋め込む <span class="help-origin-badge ..."> を
 * スタイリングする(custom.css参照)。それ以外のテーマ挙動はデフォルトのまま変更しない。
 */
export default DefaultTheme;
