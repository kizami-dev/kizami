/**
 * Vite の型を直接 import できないため(vite は waku 経由の間接依存で、
 * pnpm の厳密なホイスティングにより apps/web からは解決できない)、
 * ここで最小限のアンビエント宣言を用意する。
 */

declare module "*.css" {
  const noop: void;
  export default noop;
}

interface ImportMetaEnv {
  /** apps/api のベース URL。未設定時は http://localhost:3001 にフォールバックする。 */
  readonly WAKU_PUBLIC_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
