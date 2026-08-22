"use client";

import { useEffect, useState } from "react";

/**
 * オフライン検知(PWA、v0.4)。
 *
 * 打刻は正確な時刻が必要なため、v0.4ではオフライン時のキューイングは実装しない
 * (依頼の禁止事項)。代わりに画面上で「オフラインでは打刻できない」ことを明示し、
 * オンラインに戻り次第すぐ打刻できるようにする。画面自体(Service Worker のアプリシェル
 * キャッシュ)は開けるため、このフックは打刻ボタンの活性制御・通知表示にのみ使う。
 */
export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine));

  useEffect(() => {
    function handleOnline() {
      setOnline(true);
    }
    function handleOffline() {
      setOnline(false);
    }
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  return online;
}
