import { beforeEach, describe, expect, it } from "vitest";
import { migrateDb, type Database } from "./support/db.js";
import {
  countUnread,
  createNotificationIfAbsent,
  listNotifications,
  markNotificationRead,
} from "../src/queries/notifications.js";
import { notifications, tenants, users } from "../src/schema/index.js";
import { uuidv7 } from "../src/uuid.js";

describe("notifications", () => {
  let db: Database;
  const tenantId = uuidv7();
  const userId = uuidv7();
  const otherUserId = uuidv7();

  beforeEach(async () => {
    ({ db } = await migrateDb());
    await db.insert(tenants).values({ id: tenantId, name: "Tenant A", createdAt: 0 });
    await db.insert(users).values([
      { id: userId, tenantId, email: "a@example.com", name: "A", createdAt: 0 },
      { id: otherUserId, tenantId, email: "b@example.com", name: "B", createdAt: 0 },
    ]);
  });

  describe("createNotificationIfAbsent", () => {
    it("creates a notification with readAt null", async () => {
      const notification = await createNotificationIfAbsent(db, {
        tenantId,
        userId,
        type: "missing_clock_out",
        subjectDate: "2026-08-10",
        title: "退勤打刻がありません",
        body: "2026-08-10 の退勤打刻が記録されていません。",
        createdAt: 100,
      });

      expect(notification).not.toBeNull();
      expect(notification?.readAt).toBeNull();
      expect(notification?.subjectDate).toBe("2026-08-10");
    });

    it("returns null and skips the insert on a (tenantId, userId, type, subjectDate) duplicate", async () => {
      const first = await createNotificationIfAbsent(db, {
        tenantId,
        userId,
        type: "missing_clock_out",
        subjectDate: "2026-08-10",
        title: "退勤打刻がありません",
        body: "body",
        createdAt: 100,
      });
      expect(first).not.toBeNull();

      const second = await createNotificationIfAbsent(db, {
        tenantId,
        userId,
        type: "missing_clock_out",
        subjectDate: "2026-08-10",
        title: "退勤打刻がありません(2回目)",
        body: "body 2",
        createdAt: 200,
      });
      expect(second).toBeNull();

      const all = await listNotifications(db, { tenantId, userId });
      expect(all).toHaveLength(1);
      expect(all[0]?.title).toBe("退勤打刻がありません");
    });

    it("allows the same type/subjectDate for a different user", async () => {
      await createNotificationIfAbsent(db, {
        tenantId,
        userId,
        type: "missing_clock_out",
        subjectDate: "2026-08-10",
        title: "t",
        body: "b",
        createdAt: 0,
      });
      const other = await createNotificationIfAbsent(db, {
        tenantId,
        userId: otherUserId,
        type: "missing_clock_out",
        subjectDate: "2026-08-10",
        title: "t",
        body: "b",
        createdAt: 0,
      });
      expect(other).not.toBeNull();
    });

    it("allows the same (tenantId, userId, type) with a different subjectDate", async () => {
      const first = await createNotificationIfAbsent(db, {
        tenantId,
        userId,
        type: "missing_clock_out",
        subjectDate: "2026-08-10",
        title: "t",
        body: "b",
        createdAt: 0,
      });
      const second = await createNotificationIfAbsent(db, {
        tenantId,
        userId,
        type: "missing_clock_out",
        subjectDate: "2026-08-11",
        title: "t",
        body: "b",
        createdAt: 0,
      });
      expect(first).not.toBeNull();
      expect(second).not.toBeNull();
    });
  });

  describe("listNotifications / countUnread / markNotificationRead", () => {
    it("orders newest first and filters by unreadOnly", async () => {
      const first = await createNotificationIfAbsent(db, {
        tenantId,
        userId,
        type: "missing_clock_out",
        subjectDate: "2026-08-01",
        title: "1st",
        body: "b",
        createdAt: 0,
      });
      const second = await createNotificationIfAbsent(db, {
        tenantId,
        userId,
        type: "missing_clock_out",
        subjectDate: "2026-08-02",
        title: "2nd",
        body: "b",
        createdAt: 1,
      });
      expect(first).not.toBeNull();
      expect(second).not.toBeNull();

      const all = await listNotifications(db, { tenantId, userId });
      expect(all.map((n) => n.id)).toEqual([second!.id, first!.id]);

      expect(await countUnread(db, { tenantId, userId })).toBe(2);

      const marked = await markNotificationRead(db, { id: first!.id, tenantId, userId, readAt: 50 });
      expect(marked?.readAt).toBe(50);

      expect(await countUnread(db, { tenantId, userId })).toBe(1);

      const unreadOnly = await listNotifications(db, { tenantId, userId, unreadOnly: true });
      expect(unreadOnly.map((n) => n.id)).toEqual([second!.id]);
    });

    it("does not include another user's notifications", async () => {
      await createNotificationIfAbsent(db, {
        tenantId,
        userId: otherUserId,
        type: "missing_clock_out",
        subjectDate: "2026-08-01",
        title: "other",
        body: "b",
        createdAt: 0,
      });

      expect(await listNotifications(db, { tenantId, userId })).toHaveLength(0);
      expect(await countUnread(db, { tenantId, userId })).toBe(0);
    });

    it("markNotificationRead returns null for another user's notification or an unknown id", async () => {
      const mine = await createNotificationIfAbsent(db, {
        tenantId,
        userId,
        type: "missing_clock_out",
        subjectDate: "2026-08-01",
        title: "mine",
        body: "b",
        createdAt: 0,
      });
      expect(mine).not.toBeNull();

      expect(await markNotificationRead(db, { id: mine!.id, tenantId, userId: otherUserId, readAt: 1 })).toBeNull();
      expect(await markNotificationRead(db, { id: uuidv7(), tenantId, userId, readAt: 1 })).toBeNull();
    });

    it("caps results at the given limit", async () => {
      const values = Array.from({ length: 5 }, (_, i) => ({
        id: uuidv7(),
        tenantId,
        userId,
        type: "missing_clock_out",
        subjectDate: `2026-08-${String(i + 1).padStart(2, "0")}`,
        title: `n${i}`,
        body: "b",
        createdAt: i,
        readAt: null,
      }));
      await db.insert(notifications).values(values);

      const limited = await listNotifications(db, { tenantId, userId, limit: 2 });
      expect(limited).toHaveLength(2);
    });
  });
});
