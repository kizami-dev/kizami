"use client";

import { useEffect } from "react";

const VIEWPORT_CONTENT = "width=device-width, initial-scale=1, viewport-fit=cover";

/**
 * `<meta name="viewport">` を1つだけ・viewport-fit=cover 付きに正規化する。
 *
 * 独自判断点(完了報告に明記): Waku(1.0.0-beta.9)の静的書き出し+クライアントハイドレーション
 * では、既定シェル(node_modules/waku/dist/minimal/client.js の DEFAULT_HTML_HEAD)が
 * `viewport-fit` 無しの `<meta name="viewport">` を無条件に追加し、`_root.tsx`(公式に推奨される
 * ドキュメントシェルの上書き手段)を用意してもこれを止められない。しかも初回HTML(SSR)だけでなく
 * クライアント側の再ハイドレーション時にも再度追加されるため、一度だけ整理しても後から
 * 復活しうる。ここでは MutationObserver で head の変化を監視し、都度「1つだけ・cover付き」に
 * 補正し続けることで、ブラウザの「最初の viewport メタのみ有効」という挙動に頼らず確実にする。
 */
function normalizeViewportMeta() {
  const metas = document.head.querySelectorAll('meta[name="viewport"]');
  metas.forEach((el, i) => {
    if (i === 0) {
      if (el.getAttribute("content") !== VIEWPORT_CONTENT) {
        el.setAttribute("content", VIEWPORT_CONTENT);
      }
    } else {
      el.remove();
    }
  });
}

/**
 * PWA関連のクライアント初期化(v0.4)。マークアップは描画しない。
 *
 * - Service Worker の登録: Waku(RSCベース)には PWA プラグインが無いため、`public/sw.js`
 *   (静的ファイル、apps/web/public/sw.js)を素の Service Worker として手動登録する
 * - viewport メタの正規化: 上記コメント参照(iOSセーフエリア対応、header.css/punch-home.css の
 *   env(safe-area-inset-*) が effective に効くために必要)
 */
export function PwaRegister() {
  useEffect(() => {
    normalizeViewportMeta();
    const observer = new MutationObserver(normalizeViewportMeta);
    observer.observe(document.head, { childList: true });

    let cancelled = false;
    const hasServiceWorker = typeof navigator !== "undefined" && "serviceWorker" in navigator;
    // 初回ロードを遅延させないよう load 完了後に登録する。
    const register = () => {
      if (cancelled) return;
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // 登録に失敗してもアプリ自体は通常どおり(オンライン前提で)動作し続ける。
      });
    };
    if (hasServiceWorker) {
      if (document.readyState === "complete") {
        register();
      } else {
        window.addEventListener("load", register, { once: true });
      }
    }

    return () => {
      cancelled = true;
      window.removeEventListener("load", register);
      observer.disconnect();
    };
  }, []);

  return null;
}
