import type { ReactNode } from "react";
import { PwaRegister } from "../components/PwaRegister";
import { THEME_INIT_SCRIPT } from "../lib/theme";
import "../styles/tokens.css";
import "../styles/base.css";
import "../styles/header.css";
import "../styles/login.css";
import "../styles/punch-home.css";
import "../styles/monthly.css";
import "../styles/corrections.css";
import "../styles/notifications.css";
import "../styles/settings.css";
import "../styles/personal-notifications.css";
import "../styles/org-settings.css";
import "../styles/law.css";
import "../styles/leave.css";
import "../styles/help.css";
import "../styles/help-settings.css";
import "../styles/privacy-settings.css";
import "../styles/attendance-settings.css";
import "../styles/api-keys-settings.css";

export default async function RootLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {/* charSet・viewport・generator は src/pages/_root.tsx がドキュメントシェルとして
          出力するが、Waku(1.0.0-beta.9)の静的書き出しでは既定シェル(node_modules/waku/dist/
          minimal/client.js の DEFAULT_HTML_HEAD)がそれとは別に無条件で先頭へ挿入され、
          `<meta name="viewport">` が2つ(viewport-fit=cover 無し版が先)並んでしまう
          (独自判断・完了報告に明記: _root.tsx を用意する公式手順だけでは解消しない実装上の制約)。
          ブラウザは最初に出現した viewport メタだけを採用するため、このままだと
          viewport-fit=cover が効かずセーフエリア対応(PWA、v0.4)が機能しない。
          回避策として、DOM構築後に重複メタを1つに正規化する同期インラインスクリプトを置く。
          _layout.tsx のコンテンツは(_root.tsx と違い)実際に1回だけ出力されることを確認済みのため、
          このスクリプト自身が重複実行される心配はない。 */}
      <script
        // biome-ignore lint: 上記コメントの回避策。安全な固定文字列のみを注入する(ユーザー入力なし)。
        dangerouslySetInnerHTML={{
          __html:
            'document.querySelectorAll(\'meta[name="viewport"]\').forEach(function(el,i){i===0?el.setAttribute("content","width=device-width, initial-scale=1, viewport-fit=cover"):el.remove();});',
        }}
      />
      <title>KIZAMI</title>
      <meta name="description" content="1分単位で時を刻む勤怠管理。" />

      {/* PWA(v0.4): マニフェスト・テーマカラー・アイコン。apps/web/public 配下は Waku の
          public ディレクトリ規約でルート相対に配信される。 */}
      <link rel="manifest" href="/manifest.json" />
      <meta name="theme-color" content="#1A1A1A" />

      {/* ダークテーマの FOUC(初期表示のちらつき)防止(2026-08-22 追加)。
          localStorage の保存値を読み、ハイドレーション前に同期実行して data-theme 属性・
          theme-color メタを確定させる(詳細は lib/theme.ts 参照)。上の <meta name="theme-color">
          より後ろに置く必要がある(このスクリプトは document.querySelector でそのメタ要素を
          探すため、HTML 中でメタより前にあると要素がまだ存在せず更新できない)。 */}
      <script
        // biome-ignore lint: THEME_INIT_SCRIPT は lib/theme.ts が生成する固定ロジック文字列
        // (ユーザー入力を含まない)。JSON.stringify でリテラルを埋め込んでいるため安全。
        dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }}
      />

      <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
      <link rel="icon" href="/favicon-32.png" sizes="32x32" type="image/png" />
      {/* iOS Safari はホーム画面追加時、manifest.json ではなくこの2つのメタタグ・リンクを見る。 */}
      <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
      <meta name="apple-mobile-web-app-capable" content="yes" />
      <meta name="apple-mobile-web-app-title" content="KIZAMI" />
      <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />

      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
      <link
        rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=Shippori+Antique+B1&family=Jost:wght@500&family=Zen+Kaku+Gothic+New:wght@400;500;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap"
      />
      {children}
      <PwaRegister />
    </>
  );
}

export const getConfig = async () => {
  return { render: "static" } as const;
};
