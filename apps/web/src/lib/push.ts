/**
 * ブラウザプッシュ通知(Web Push)のクライアント側手続き(2026-08-24 追加)。
 * サーバー側の設計は docs/design/web-push.md。
 *
 * ここに閉じ込めるもの:
 * - この環境でプッシュ通知が使えるか(Service Worker / PushManager / Notification の有無)
 * - 通知許可の取得 → PushManager.subscribe → apps/api への登録、の一連の流れ
 * - 購読解除(ブラウザ側の unsubscribe と apps/api 側の削除の両方)
 *
 * 判断点: Service Worker の登録そのものは components/PwaRegister.tsx が既に行っているため、
 * ここでは `navigator.serviceWorker.ready` を待つだけにする(二重登録しない)。ready は
 * PwaRegister が register() を呼ぶまで解決しないので、購読ボタンを押した時点で SW の
 * 準備が済んでいなくても自然に待てる。
 *
 * 権限が "denied" の場合、ブラウザは requestPermission() を出してくれない(ダイアログが
 * 二度と出ない)。UI 側で「ブラウザの設定から通知を許可し直してください」と案内する必要が
 * あるため、状態を文字列で返して呼び出し側に判断させる。
 */

import { api, ApiError, type PushSubscriptionJson } from "./api";

/** 購読処理の結果。UI はこれを見て表示する文言を選ぶ。 */
export type PushSubscribeResult =
  | { status: "subscribed"; endpoint: string }
  /** ユーザーがダイアログを閉じた(次回また聞ける) */
  | { status: "permission_dismissed" }
  /** ブロック済み。ブラウザ設定から解除してもらう必要がある */
  | { status: "permission_denied" }
  /** この配備は VAPID 鍵が未設定(サーバーが 404 push_unavailable を返した) */
  | { status: "unavailable" }
  | { status: "failed"; error: unknown };

/** この環境(ブラウザ)でプッシュ通知が使えるか。SSR 中は常に false。 */
export function isPushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

/** 現在の通知許可状態。未対応環境では "unsupported"。 */
export function notificationPermission(): NotificationPermission | "unsupported" {
  if (!isPushSupported()) return "unsupported";
  return Notification.permission;
}

/** base64url の VAPID 公開鍵を PushManager.subscribe が要求する Uint8Array へ変換する。 */
function base64UrlToUint8Array(value: string): Uint8Array {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** PushSubscription を apps/api へ送れる形(endpoint + keys)へ変換する。 */
function toSubscriptionJson(subscription: PushSubscription): PushSubscriptionJson | null {
  const json = subscription.toJSON();
  const p256dh = json.keys?.p256dh;
  const auth = json.keys?.auth;
  if (!json.endpoint || !p256dh || !auth) return null;
  return { endpoint: json.endpoint, keys: { p256dh, auth } };
}

/** このブラウザの現在の購読(未購読なら null)。 */
export async function currentPushSubscription(): Promise<PushSubscription | null> {
  if (!isPushSupported()) return null;
  const registration = await navigator.serviceWorker.ready;
  return registration.pushManager.getSubscription();
}

/**
 * 通知許可 → 購読 → apps/api への登録、をまとめて行う。
 *
 * 既に購読済みの場合も POST し直す(endpoint 単位の upsert なので重複しない)。これは
 * 「サーバー側の行だけが消えている / failed_at が立っている」状態からの復旧経路になる。
 */
export async function enablePush(): Promise<PushSubscribeResult> {
  if (!isPushSupported()) return { status: "failed", error: new Error("push is not supported in this browser") };

  if (Notification.permission === "denied") return { status: "permission_denied" };

  let publicKey: string;
  try {
    publicKey = (await api.getVapidPublicKey()).publicKey;
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return { status: "unavailable" };
    return { status: "failed", error: err };
  }

  if (Notification.permission !== "granted") {
    const permission = await Notification.requestPermission();
    if (permission === "denied") return { status: "permission_denied" };
    // "default" = ダイアログを閉じられた(拒否ではない)。次回また聞ける。
    if (permission !== "granted") return { status: "permission_dismissed" };
  }

  try {
    const registration = await navigator.serviceWorker.ready;
    const existing = await registration.pushManager.getSubscription();
    // 既存の購読が別の VAPID 公開鍵で作られている場合(運用者が鍵を入れ替えた等)は
    // subscribe() が InvalidStateError になるため、いったん解除してから作り直す。
    if (existing) await existing.unsubscribe();

    const subscription = await registration.pushManager.subscribe({
      // Chrome は userVisibleOnly: true 以外を拒否する。KIZAMI は常に通知を表示するので問題ない。
      userVisibleOnly: true,
      applicationServerKey: base64UrlToUint8Array(publicKey) as BufferSource,
    });

    const json = toSubscriptionJson(subscription);
    if (!json) return { status: "failed", error: new Error("PushSubscription did not expose the expected keys") };

    await api.createPushSubscription(json);
    return { status: "subscribed", endpoint: json.endpoint };
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return { status: "unavailable" };
    return { status: "failed", error: err };
  }
}

/**
 * このブラウザの購読を解除する(ブラウザ側 unsubscribe + apps/api 側の削除)。
 *
 * サーバー側の削除が 404 になっても成功として扱う(既に消えている = 望む状態のため)。
 * 逆にブラウザ側の unsubscribe が失敗してもサーバー側の削除は試みる — 行が残ったままだと
 * 通知が届き続けるので、より害の少ない側(送らない)へ倒す。
 */
export async function disablePush(): Promise<{ ok: boolean; error?: unknown }> {
  if (!isPushSupported()) return { ok: true };

  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (!subscription) return { ok: true };

    const endpoint = subscription.endpoint;
    await subscription.unsubscribe().catch(() => undefined);
    try {
      await api.deletePushSubscription(endpoint);
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 404)) throw err;
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err };
  }
}
