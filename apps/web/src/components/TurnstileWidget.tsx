"use client";

import { useEffect, useRef } from "react";

/**
 * Cloudflare Turnstile ウィジェット(セルフサインアップ用、2026-10-03)。
 *
 * `https://challenges.cloudflare.com/turnstile/v0/api.js` を明示レンダリング(`render=explicit`)で
 * 読み込み、発行されたトークンを `onToken` で親へ渡す(検証はサーバー側の POST /signup。トークンは
 * 1回しか使えないので、送信に失敗したら親が `resetKey` を進めてウィジェットを作り直させる)。
 * 失効・エラー時は `onToken(null)` で親のトークンを空に戻す。
 *
 * CSP: このリポジトリの配信設定(Caddy / Waku)に Content-Security-Policy は設定されていないため
 * 許可の追加は不要。もし配備側で CSP を入れる場合は、`script-src` / `frame-src` に
 * `https://challenges.cloudflare.com` を許可すること(docs/design/saas.md の環境変数の節)。
 */

const SCRIPT_ID = "cf-turnstile-script";
const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

interface TurnstileApi {
  render(
    container: HTMLElement,
    options: {
      sitekey: string;
      callback: (token: string) => void;
      "expired-callback": () => void;
      "error-callback": () => void;
    },
  ): string;
  remove(widgetId: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

/** スクリプトを1度だけ読み込み、`window.turnstile` が使えるようになったら解決する。 */
function loadTurnstile(): Promise<TurnstileApi> {
  return new Promise((resolve, reject) => {
    if (window.turnstile) {
      resolve(window.turnstile);
      return;
    }
    let script = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
    if (!script) {
      script = document.createElement("script");
      script.id = SCRIPT_ID;
      script.src = SCRIPT_SRC;
      script.async = true;
      script.defer = true;
      document.head.appendChild(script);
    }
    script.addEventListener("load", () => (window.turnstile ? resolve(window.turnstile) : reject(new Error("turnstile unavailable"))));
    script.addEventListener("error", () => reject(new Error("failed to load turnstile")));
  });
}

export function TurnstileWidget({
  siteKey,
  onToken,
  resetKey = 0,
}: {
  siteKey: string;
  onToken: (token: string | null) => void;
  /** 値が変わるとウィジェットを作り直す(トークンは単回使用のため、送信失敗後に進める) */
  resetKey?: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  // コールバックは最新の onToken を呼びたいが、それを依存に入れるとウィジェットが作り直されてしまう
  const onTokenRef = useRef(onToken);
  onTokenRef.current = onToken;

  useEffect(() => {
    let widgetId: string | null = null;
    let cancelled = false;
    onTokenRef.current(null);
    loadTurnstile()
      .then((turnstile) => {
        if (cancelled || !containerRef.current) return;
        widgetId = turnstile.render(containerRef.current, {
          sitekey: siteKey,
          callback: (token) => onTokenRef.current(token),
          "expired-callback": () => onTokenRef.current(null),
          "error-callback": () => onTokenRef.current(null),
        });
      })
      .catch(() => {
        // 読み込めなければトークンが得られず送信できない(フォーム側が「確認を完了してください」を出す)
      });
    return () => {
      cancelled = true;
      if (widgetId !== null && window.turnstile) window.turnstile.remove(widgetId);
    };
  }, [siteKey, resetKey]);

  return <div ref={containerRef} className="signup-turnstile" />;
}
