/**
 * Service Worker の判定ロジック(副作用なしの純関数)。sw.js から importScripts で読み込む。
 * テストは apps/web/test/sw-lib.test.ts(ファイルを文字列で読んで評価する)。
 */
(function (root) {
  // トークン(再設定・招待・メール確認)を URL に含むページ。ここをキャッシュに残すと、
  // 共有端末でトークン付き URL がキャッシュに残り続ける。
  var SENSITIVE_PATH_PREFIXES = ["/reset", "/invite", "/signup", "/forgot-password", "/api", "/auth"];
  var SENSITIVE_QUERY_KEYS = ["token", "code", "key", "invite", "reset", "state", "secret", "password", "otp"];

  /** 通知クリックで開く URL。同一オリジンのものだけ許し、それ以外・解釈できないものは "/" に落とす。 */
  function safeNotificationUrl(url, origin) {
    try {
      var u = new URL(typeof url === "string" ? url : "/", origin);
      if (u.origin !== origin) return "/";
      return u.pathname + u.search + u.hash;
    } catch (e) {
      return "/";
    }
  }

  /** この URL のレスポンスをキャッシュに入れてよいか(トークン付き・認証・API は入れない)。 */
  function isCacheableUrl(url, origin) {
    var u;
    try {
      u = new URL(url, origin);
    } catch (e) {
      return false;
    }
    if (u.origin === origin) {
      var path = u.pathname.toLowerCase();
      for (var i = 0; i < SENSITIVE_PATH_PREFIXES.length; i++) {
        var p = SENSITIVE_PATH_PREFIXES[i];
        // 「/reset」本体と「/reset/…」だけ。「/resetting」のような別パスは巻き込まない
        if (path === p || path.indexOf(p + "/") === 0) return false;
      }
    }
    var keys = Array.from(u.searchParams.keys());
    for (var j = 0; j < keys.length; j++) {
      if (SENSITIVE_QUERY_KEYS.indexOf(keys[j].toLowerCase()) !== -1) return false;
    }
    return true;
  }

  /** レスポンスがキャッシュ禁止(no-store / private)を示していないか。opaque は中身が見えないので許す。 */
  function isCacheableResponse(response) {
    if (!response) return false;
    if (response.type === "opaque") return true;
    if (!response.ok) return false;
    var cc = (response.headers && response.headers.get("cache-control")) || "";
    return !/no-store|private/i.test(cc);
  }

  root.KizamiSwLib = {
    safeNotificationUrl: safeNotificationUrl,
    isCacheableUrl: isCacheableUrl,
    isCacheableResponse: isCacheableResponse,
  };
})(self);
