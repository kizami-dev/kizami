import type { ReactNode } from "react";

/**
 * ドキュメントシェル(`<html>`/`<head>`/`<body>`)を明示的に定義する(PWA、v0.4)。
 *
 * Waku は `_root.tsx` が無いと既定のシェルを使い、その `<head>` には
 * `<meta charSet>` / `<meta name="viewport" content="width=device-width, initial-scale=1">` /
 * `<meta name="generator">` が固定で先頭に挿入される(node_modules/waku/dist/minimal/client.js の
 * DEFAULT_HTML_HEAD)。これは `_layout.tsx` 側が返す `<head>` 相当のタグ列と単純結合されるだけで
 * 重複除去はされないため、PWA対応で `_layout.tsx` に `viewport-fit=cover` 付きの
 * `<meta name="viewport">` を追加すると、同名メタタグが2つ並ぶ状態になっていた
 * (ブラウザは最初の1つ目のみを採用するため、既定値のまま=セーフエリア対応が効かない)。
 *
 * `_root.tsx` を自前で用意することでこの既定シェルを丸ごと上書きし、`viewport-fit=cover` を
 * 含む単一の viewport メタタグだけが出力されるようにする(Waku公式ドキュメント推奨の方法)。
 */
export default async function RootElement({ children }: { children: ReactNode }) {
  return (
    <html lang="ja">
      <head>
        <meta charSet="utf-8" />
        {/* viewport-fit=cover: iPhoneのノッチ・ホームバー領域まで背景を敷き、
            env(safe-area-inset-*) をCSS側(header.css・punch-home.css)で使えるようにする。 */}
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <meta name="generator" content="Waku" />
      </head>
      <body>{children}</body>
    </html>
  );
}
