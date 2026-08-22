/**
 * KIZAMI Service Worker(PWA、v0.4、docs/requirements.md §3)。
 *
 * 方針(最小限):
 * - アプリシェル(ナビゲーション先のHTML・JS・CSS・画像・フォント)をキャッシュし、
 *   オフラインでも画面が開けるようにする
 * - 打刻APIを含む fetch()/XHR 呼び出しは一切キャッシュしない。常に最新の状態を取る
 *   (apps/web/src/lib/api.ts の request() はすべて fetch() で行われる)
 * - オフライン時の打刻はキューイングしない(実際の打刻時刻と記録時刻がずれるため、
 *   v0.4では明示的にスコープ外。docs/requirements.md §3・依頼の禁止事項)
 *
 * 実装上のポイント: Request.destination で仕分ける。
 * - "document"(ページ遷移・リロード) と、script/style/image/font/manifest(静的アセット)
 *   だけを本SWが扱う
 * - fetch()/XHR で発行されたリクエストは destination が "" になる(WHATWG Fetch仕様)。
 *   apps/api への呼び出しはすべてこれに該当するため、判定を分岐せずとも自然にSWの
 *   対象外になる — API URL のホスト名やパスをハードコードして除外する必要が無い
 *   (開発時のポート違い・本番のリバースプロキシ配下 /api どちらでも安全に素通しできる)。
 */

const CACHE_VERSION = "kizami-shell-v1";
const HANDLED_DESTINATIONS = new Set(["", "document"]);
const STATIC_DESTINATIONS = new Set(["script", "style", "image", "font", "manifest"]);

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((key) => key !== CACHE_VERSION).map((key) => caches.delete(key)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const isNavigation = request.mode === "navigate" || request.destination === "document";
  const isStaticAsset = STATIC_DESTINATIONS.has(request.destination);

  // fetch()/XHR(destination === "" かつ非ナビゲーション、= apps/api への全呼び出しを含む)は
  // 一切手を出さない。ブラウザの通常の(SWを介さない)ネットワーク処理に委ねる。
  if (!isNavigation && !isStaticAsset) return;

  if (isNavigation) {
    event.respondWith(networkFirstForNavigation(request));
    return;
  }

  event.respondWith(staleWhileRevalidate(event));
});

/** ナビゲーション: オンラインなら常に最新のHTMLを取得し、キャッシュに保存する。オフラインならキャッシュから返す。 */
async function networkFirstForNavigation(request) {
  const cache = await caches.open(CACHE_VERSION);
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    // 訪れたことのないページをオフラインで開いた場合の最終フォールバック。
    const shell = await cache.match("/");
    if (shell) return shell;
    return new Response("<!doctype html><meta charset=utf-8><title>KIZAMI</title><p>オフラインです。接続を確認してから再度開いてください。</p>", {
      status: 503,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
}

/** 静的アセット(ハッシュ付きファイル名が多く実質不変): キャッシュを即返しつつ裏で更新する。 */
async function staleWhileRevalidate(event) {
  const { request } = event;
  const cache = await caches.open(CACHE_VERSION);
  const cached = await cache.match(request);

  const networkFetch = fetch(request)
    .then((response) => {
      // クロスオリジン(Google Fonts等)の opaque レスポンスも含め、取得できたものはキャッシュする。
      if (response && (response.ok || response.type === "opaque")) {
        cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => undefined);

  if (cached) {
    // SW がレスポンスを返した後に終了しても裏のフェッチが完了できるよう、waitUntil に委ねる。
    event.waitUntil(networkFetch);
    return cached;
  }

  const networkResponse = await networkFetch;
  if (networkResponse) return networkResponse;
  return new Response(null, { status: 504 });
}
