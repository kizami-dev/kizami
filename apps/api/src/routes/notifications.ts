/**
 * GET /notifications, GET /notifications/unread-count, POST /notifications/:id/read
 *
 * アプリ内通知(v0.2 第二弾)。§7 の3チャネル(メール/Webhook/アプリ内)のうち
 * アプリ内通知の読み書きのみをここで扱う。メール/Webhook 送信は src/reminders.ts
 * (定期スキャン)側の責務で、通知作成時の副作用として行われる。
 *
 * v0.1/v0.2 第一弾と同じく本人スコープのみ(requireSelf)。
 */

import { Hono } from "hono";
import { countUnread, listNotifications, markNotificationRead, type Database, type Notification } from "@kizami/db";
import type { AppEnv } from "../auth/middleware.js";
import { requireSelf } from "../authz.js";
import { nowMinutes } from "../lib/time.js";

const MAX_LIST_LIMIT = 100;

function serializeNotification(row: Notification) {
  return {
    id: row.id,
    type: row.type,
    subjectDate: row.subjectDate,
    title: row.title,
    body: row.body,
    createdAt: row.createdAt,
    readAt: row.readAt,
  };
}

export function createNotificationsRoutes(db: Database) {
  const app = new Hono<AppEnv>();

  app.get("/", async (c) => {
    const user = c.get("user");
    requireSelf(c, user.id);

    const unreadOnlyParam = c.req.query("unreadOnly");
    if (unreadOnlyParam !== undefined && unreadOnlyParam !== "true" && unreadOnlyParam !== "false") {
      return c.json({ error: "invalid_unread_only" }, 400);
    }
    const unreadOnly = unreadOnlyParam === "true";

    const rows = await listNotifications(db, {
      tenantId: user.tenantId,
      userId: user.id,
      unreadOnly,
      limit: MAX_LIST_LIMIT,
    });

    return c.json({ notifications: rows.map(serializeNotification) });
  });

  app.get("/unread-count", async (c) => {
    const user = c.get("user");
    requireSelf(c, user.id);

    const value = await countUnread(db, { tenantId: user.tenantId, userId: user.id });
    return c.json({ count: value });
  });

  app.post("/:id/read", async (c) => {
    const user = c.get("user");
    requireSelf(c, user.id);

    const id = c.req.param("id");
    const updated = await markNotificationRead(db, { id, tenantId: user.tenantId, userId: user.id, readAt: nowMinutes() });
    if (!updated) {
      return c.json({ error: "not_found" }, 404);
    }

    return c.json({ notification: serializeNotification(updated) });
  });

  return app;
}
