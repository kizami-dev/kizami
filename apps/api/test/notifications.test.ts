import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createNotificationIfAbsent } from "@kizami/db";
import { createApp } from "../src/app.js";
import { loginAndGetCookie, setupSecondUser, setupTestDb } from "./support/setup.js";

const FIXED_NOW = new Date("2026-04-15T03:00:00.000Z");

interface NotificationJson {
  id: string;
  type: string;
  subjectDate: string | null;
  title: string;
  body: string;
  createdAt: number;
  readAt: number | null;
}

describe("notifications routes", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("GET /notifications returns the caller's notifications newest first", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();

    const older = await createNotificationIfAbsent(db, {
      tenantId,
      userId,
      type: "missing_clock_out",
      subjectDate: "2026-04-01",
      title: "older",
      body: "b",
      createdAt: 0,
    });
    const newer = await createNotificationIfAbsent(db, {
      tenantId,
      userId,
      type: "missing_clock_out",
      subjectDate: "2026-04-02",
      title: "newer",
      body: "b",
      createdAt: 1,
    });
    expect(older).not.toBeNull();
    expect(newer).not.toBeNull();

    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const res = await app.request("/notifications", { headers: { cookie } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { notifications: NotificationJson[] };
    expect(body.notifications.map((n) => n.id)).toEqual([newer!.id, older!.id]);
    expect(body.notifications[0]).toEqual({
      id: newer!.id,
      type: "missing_clock_out",
      subjectDate: "2026-04-02",
      title: "newer",
      body: "b",
      createdAt: 1,
      readAt: null,
    });
  });

  it("GET /notifications?unreadOnly=true excludes read notifications", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();

    const read = await createNotificationIfAbsent(db, {
      tenantId,
      userId,
      type: "missing_clock_out",
      subjectDate: "2026-04-01",
      title: "read",
      body: "b",
      createdAt: 0,
    });
    const unread = await createNotificationIfAbsent(db, {
      tenantId,
      userId,
      type: "missing_clock_out",
      subjectDate: "2026-04-02",
      title: "unread",
      body: "b",
      createdAt: 1,
    });
    expect(read).not.toBeNull();
    expect(unread).not.toBeNull();

    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    await app.request(`/notifications/${read!.id}/read`, { method: "POST", headers: { cookie } });

    const res = await app.request("/notifications?unreadOnly=true", { headers: { cookie } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { notifications: NotificationJson[] };
    expect(body.notifications.map((n) => n.id)).toEqual([unread!.id]);
  });

  it("GET /notifications rejects an invalid unreadOnly value with 400", async () => {
    const { db, email, password } = await setupTestDb();
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const res = await app.request("/notifications?unreadOnly=yes", { headers: { cookie } });
    expect(res.status).toBe(400);
  });

  it("GET /notifications/unread-count returns the caller's unread count", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();

    await createNotificationIfAbsent(db, {
      tenantId,
      userId,
      type: "missing_clock_out",
      subjectDate: "2026-04-01",
      title: "a",
      body: "b",
      createdAt: 0,
    });
    await createNotificationIfAbsent(db, {
      tenantId,
      userId,
      type: "missing_clock_out",
      subjectDate: "2026-04-02",
      title: "b",
      body: "b",
      createdAt: 1,
    });

    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const res = await app.request("/notifications/unread-count", { headers: { cookie } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ count: 2 });
  });

  it("POST /notifications/:id/read marks the notification read and is idempotent", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();

    const notification = await createNotificationIfAbsent(db, {
      tenantId,
      userId,
      type: "missing_clock_out",
      subjectDate: "2026-04-01",
      title: "a",
      body: "b",
      createdAt: 0,
    });
    expect(notification).not.toBeNull();

    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const res = await app.request(`/notifications/${notification!.id}/read`, { method: "POST", headers: { cookie } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { notification: NotificationJson };
    expect(body.notification.readAt).not.toBeNull();

    // 既読済みへの再リクエストも成功する(readAt が上書きされるだけ)
    const again = await app.request(`/notifications/${notification!.id}/read`, { method: "POST", headers: { cookie } });
    expect(again.status).toBe(200);

    const countRes = await app.request("/notifications/unread-count", { headers: { cookie } });
    expect(await countRes.json()).toEqual({ count: 0 });
  });

  it("POST /notifications/:id/read returns 404 for an unknown id", async () => {
    const { db, email, password } = await setupTestDb();
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const res = await app.request("/notifications/00000000-0000-0000-0000-000000000000/read", {
      method: "POST",
      headers: { cookie },
    });
    expect(res.status).toBe(404);
  });

  it("POST /notifications/:id/read returns 404 for another user's notification", async () => {
    const { db, tenantId, email, password } = await setupTestDb();
    const second = await setupSecondUser(db, tenantId);

    const notification = await createNotificationIfAbsent(db, {
      tenantId,
      userId: second.userId,
      type: "missing_clock_out",
      subjectDate: "2026-04-01",
      title: "a",
      body: "b",
      createdAt: 0,
    });
    expect(notification).not.toBeNull();

    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const res = await app.request(`/notifications/${notification!.id}/read`, { method: "POST", headers: { cookie } });
    expect(res.status).toBe(404);
  });

  it("rejects unauthenticated requests with 401 for all three endpoints", async () => {
    const { db } = await setupTestDb();
    const app = createApp({ db });

    expect((await app.request("/notifications")).status).toBe(401);
    expect((await app.request("/notifications/unread-count")).status).toBe(401);
    expect((await app.request("/notifications/some-id/read", { method: "POST" })).status).toBe(401);
  });
});
