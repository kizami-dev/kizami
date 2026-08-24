/**
 * GET /push/vapid-public-key, GET /push/subscriptions,
 * POST /push/subscriptions, DELETE /push/subscriptions
 *
 * ブラウザプッシュ通知(Web Push)の購読管理。設計は docs/design/web-push.md。
 *
 * routes/notification-preferences.ts と同じく**権限チェックは行わない** — 認証済みユーザーが
 * 自分自身(c.get("user").tenantId / .id)の購読だけを読み書きする。他人の tenant_id/user_id を
 * 指定する経路自体が存在せず、DELETE も endpoint に加えて必ず tenant_id + user_id で
 * 絞り込む(endpoint 文字列を知っているだけでは他人の購読を消せない — テナント分離規約
 * docs/design/multi-tenancy.md)。
 *
 * VAPID 鍵が未設定の配備では GET /push/vapid-public-key が 404 { error: "push_unavailable" } を
 * 返し、POST も同じく 404 で拒否する(鍵が無ければ送信できないので、購読を貯めても意味が無い)。
 * Web UI は GET /settings/notifications/me の `pushAvailable` を見て購読 UI 自体を出さないので、
 * この 404 は「UI をすり抜けた場合」の防御。
 *
 * 保存する値の検証(判断点): endpoint は http(s) URL であること、p256dh は base64url で
 * 65 バイト、auth は 16 バイトであること — を API 層で弾く。壊れた購読を保存すると送信時に
 * 毎回例外になり、スキャンのログを汚し続けるため。
 */

import { Hono } from "hono";
import {
  deletePushSubscription,
  listActivePushSubscriptions,
  upsertPushSubscription,
  type Database,
} from "@kizami/db";
import { base64UrlDecode, type VapidKeys } from "@kizami/notify";
import type { AppEnv } from "../auth/middleware.js";
import { isValidHttpUrl } from "../lib/field-validation.js";
import { nowMinutes } from "../lib/time.js";

export interface PushRoutesDeps {
  /** VAPID 鍵。null/未設定ならこのルータは購読を受け付けない(404 push_unavailable) */
  vapid?: VapidKeys | null;
}

const P256DH_BYTES = 65;
const AUTH_BYTES = 16;

function decodedLength(value: string): number | null {
  try {
    return base64UrlDecode(value).length;
  } catch {
    return null;
  }
}

interface SubscriptionInput {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

/** ブラウザの `PushSubscription.toJSON()` をそのまま受け取る想定の検証。 */
function parseSubscription(value: unknown): SubscriptionInput | null {
  if (typeof value !== "object" || value === null) return null;
  const { endpoint, keys } = value as { endpoint?: unknown; keys?: unknown };
  if (typeof endpoint !== "string" || !isValidHttpUrl(endpoint)) return null;
  if (typeof keys !== "object" || keys === null) return null;
  const { p256dh, auth } = keys as { p256dh?: unknown; auth?: unknown };
  if (typeof p256dh !== "string" || decodedLength(p256dh) !== P256DH_BYTES) return null;
  if (typeof auth !== "string" || decodedLength(auth) !== AUTH_BYTES) return null;
  return { endpoint, keys: { p256dh, auth } };
}

async function parseJsonBody(c: { req: { json: () => Promise<unknown> } }): Promise<Record<string, unknown> | null> {
  try {
    const body = await c.req.json();
    if (typeof body !== "object" || body === null) return null;
    return body as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function createPushRoutes(db: Database, deps: PushRoutesDeps = {}) {
  const app = new Hono<AppEnv>();

  // 購読に必要な公開鍵。秘密鍵は当然返さない(公開鍵はブラウザへ渡すためのものなので秘密ではない)。
  app.get("/vapid-public-key", (c) => {
    if (!deps.vapid) return c.json({ error: "push_unavailable" }, 404);
    return c.json({ publicKey: deps.vapid.publicKey });
  });

  // 自分の有効な購読の一覧(UI が「このブラウザは購読済みか」を判定するために使う)。
  // 鍵(p256dh/auth)は返さない — UI が必要とするのは endpoint の一致判定と表示用の情報だけ。
  app.get("/subscriptions", async (c) => {
    const user = c.get("user");
    const rows = await listActivePushSubscriptions(db, { tenantId: user.tenantId, userId: user.id });
    return c.json({
      subscriptions: rows.map((row) => ({
        endpoint: row.endpoint,
        userAgent: row.userAgent,
        createdAt: row.createdAt,
        lastUsedAt: row.lastUsedAt,
      })),
    });
  });

  app.post("/subscriptions", async (c) => {
    if (!deps.vapid) return c.json({ error: "push_unavailable" }, 404);

    const user = c.get("user");
    const body = await parseJsonBody(c);
    if (body === null) return c.json({ error: "invalid_body" }, 400);

    const subscription = parseSubscription(body.subscription);
    if (!subscription) return c.json({ error: "invalid_subscription" }, 400);

    // 端末の見分け用。長い UA 文字列をそのまま保存しても意味が薄いので頭だけ切る。
    const userAgent = c.req.header("user-agent")?.slice(0, 255) ?? null;

    const row = await upsertPushSubscription(db, {
      tenantId: user.tenantId,
      userId: user.id,
      endpoint: subscription.endpoint,
      keysP256dh: subscription.keys.p256dh,
      keysAuth: subscription.keys.auth,
      userAgent,
      createdAt: nowMinutes(),
    });

    return c.json({ endpoint: row.endpoint, createdAt: row.createdAt });
  });

  app.delete("/subscriptions", async (c) => {
    const user = c.get("user");
    const body = await parseJsonBody(c);
    if (body === null) return c.json({ error: "invalid_body" }, 400);
    const endpoint = body.endpoint;
    if (typeof endpoint !== "string" || endpoint === "") return c.json({ error: "invalid_endpoint" }, 400);

    // tenant_id + user_id で必ず絞り込むため、他人の購読は「見つからない」= 404 になる。
    const deleted = await deletePushSubscription(db, { tenantId: user.tenantId, userId: user.id, endpoint });
    if (!deleted) return c.json({ error: "not_found" }, 404);
    return c.json({ ok: true });
  });

  return app;
}
