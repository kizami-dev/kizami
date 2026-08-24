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
 * - ブラウザプッシュ通知(Web Push、2026-08-24 追加。docs/design/web-push.md)の受信と
 *   クリック時の画面遷移をこの SW が担う(ページが閉じていても動く唯一の場所であるため)
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

// ---------------------------------------------------------------------------
// ブラウザプッシュ通知(Web Push、2026-08-24 追加。docs/design/web-push.md)
// ---------------------------------------------------------------------------

/**
 * ペイロードの契約: apps/api が送るのは `{"title","body","url"}` の JSON だけ
 * (packages/notify/src/web-push.ts の webPushChannel)。項目を増やすときは両方を同時に直すこと。
 *
 * 判断点: ペイロードが壊れている・空の場合でも「何か届いたこと」は伝わるよう、
 * 汎用の文言で必ず1件は表示する。プッシュを受け取ったのに通知を出さないと、
 * ブラウザによっては「サイトが勝手に通知権限を使っている」と判断され購読を切られるため。
 */
self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = {};
  }

  const title = typeof payload.title === "string" && payload.title !== "" ? payload.title : "KIZAMI";
  const body = typeof payload.body === "string" ? payload.body : "";
  const url = typeof payload.url === "string" && payload.url !== "" ? payload.url : "/";

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      // 同じ通知が重複して届いた場合に積み上がらないよう、遷移先で束ねる
      // (アプリ内通知側の重複防止(createNotificationIfAbsent)と役割が重なるが、
      //  プッシュサービスの再送などここでしか防げない重複もあるため両方で守る)。
      tag: url,
      data: { url },
    }),
  );
});

/**
 * 通知クリック: 既に KIZAMI を開いているタブがあればそれを前面に出して遷移し、
 * 無ければ新しく開く(通知のたびにタブが増えるのを避ける)。
 */
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data && typeof event.notification.data.url === "string" ? event.notification.data.url : "/";

  event.waitUntil(
    (async () => {
      const target = new URL(url, self.location.origin);
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of windows) {
        if (new URL(client.url).origin !== target.origin) continue;
        await client.focus();
        if ("navigate" in client) await client.navigate(target.href);
        return;
      }
      await self.clients.openWindow(target.href);
    })(),
  );
});
