import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { insertPunchEvent, listNotifications } from "@kizami/db";
import type { NotificationChannel, NotificationMessage } from "@kizami/notify";
import { createApp } from "../src/app.js";
import { runReminderScan } from "../src/reminders.js";
import { jstMinutes, loginAndGetCookie, setupSecondUser, setupTestDb } from "./support/setup.js";

// 修正申請の approve フロー(corrections.test.ts と同じ固定時刻: JST 2026-04-15 12:00)。
const FIXED_NOW = new Date("2026-04-15T03:00:00.000Z");
const FIXED_NOW_MINUTES = Math.floor(FIXED_NOW.getTime() / 60_000);

describe("runReminderScan", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("creates a missing_clock_out notification for a past day with no clock-out", async () => {
    const { db, tenantId, userId } = await setupTestDb();

    const clockInAt = jstMinutes(2026, 4, 1, 9, 0);
    await insertPunchEvent(db, {
      tenantId,
      userId,
      kind: "clock_in",
      occurredAt: clockInAt,
      recordedAt: clockInAt,
      source: "web",
      actorId: userId,
    });

    const result = await runReminderScan(db, { nowMinutes: FIXED_NOW_MINUTES });

    expect(result.scannedUserCount).toBe(1);
    expect(result.created).toHaveLength(1);
    expect(result.created[0]?.notification.type).toBe("missing_clock_out");
    expect(result.created[0]?.notification.subjectDate).toBe("2026-04-01");
    expect(result.created[0]?.notification.readAt).toBeNull();

    const stored = await listNotifications(db, { tenantId, userId });
    expect(stored).toHaveLength(1);
    expect(stored[0]?.subjectDate).toBe("2026-04-01");
  });

  it("does not create a notification for today's still-in-progress day (day boundary not yet crossed)", async () => {
    const { db, tenantId, userId } = await setupTestDb();

    // 「今日」は FIXED_NOW と同じ 2026-04-15(JST)、まだ日界(翌日0時)を過ぎていない
    const clockInAt = jstMinutes(2026, 4, 15, 9, 0);
    await insertPunchEvent(db, {
      tenantId,
      userId,
      kind: "clock_in",
      occurredAt: clockInAt,
      recordedAt: clockInAt,
      source: "web",
      actorId: userId,
    });

    const result = await runReminderScan(db, { nowMinutes: FIXED_NOW_MINUTES });

    expect(result.created).toHaveLength(0);
    expect(await listNotifications(db, { tenantId, userId })).toHaveLength(0);
  });

  it("is idempotent: scanning twice for the same missing day only creates one notification", async () => {
    const { db, tenantId, userId } = await setupTestDb();

    const clockInAt = jstMinutes(2026, 4, 1, 9, 0);
    await insertPunchEvent(db, {
      tenantId,
      userId,
      kind: "clock_in",
      occurredAt: clockInAt,
      recordedAt: clockInAt,
      source: "web",
      actorId: userId,
    });

    const first = await runReminderScan(db, { nowMinutes: FIXED_NOW_MINUTES });
    expect(first.created).toHaveLength(1);

    const second = await runReminderScan(db, { nowMinutes: FIXED_NOW_MINUTES + 5 });
    expect(second.created).toHaveLength(0);

    expect(await listNotifications(db, { tenantId, userId })).toHaveLength(1);
  });

  it("creates no notification once the correction request supplying the missing clock-out is approved", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const clockInAt = jstMinutes(2026, 4, 1, 9, 0);
    const clockInRes = await app.request("/punches", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ kind: "clock_in", occurredAt: clockInAt }),
    });
    expect(clockInRes.status).toBe(201);

    // スキャンを一度も走らせないまま、退勤打刻の追加申請を承認して補完する
    const clockOutAt = jstMinutes(2026, 4, 1, 18, 0);
    const createRes = await app.request("/corrections", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ proposedKind: "clock_out", proposedOccurredAt: clockOutAt, reason: "退勤打刻を忘れた" }),
    });
    expect(createRes.status).toBe(201);
    const created = ((await createRes.json()) as { request: { id: string } }).request;

    const approveRes = await app.request(`/corrections/${created.id}/approve`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({}),
    });
    expect(approveRes.status).toBe(200);

    const result = await runReminderScan(db, { nowMinutes: FIXED_NOW_MINUTES });

    expect(result.created).toHaveLength(0);
    expect(await listNotifications(db, { tenantId, userId })).toHaveLength(0);
  });

  it("dispatches to external channels only for newly created notifications, not for duplicates", async () => {
    const { db, tenantId, userId } = await setupTestDb();

    const clockInAt = jstMinutes(2026, 4, 1, 9, 0);
    await insertPunchEvent(db, {
      tenantId,
      userId,
      kind: "clock_in",
      occurredAt: clockInAt,
      recordedAt: clockInAt,
      source: "web",
      actorId: userId,
    });

    const sent: NotificationMessage[] = [];
    const fakeChannel: NotificationChannel = {
      name: "fake",
      async send(msg) {
        sent.push(msg);
      },
    };

    const first = await runReminderScan(db, { nowMinutes: FIXED_NOW_MINUTES, channels: [fakeChannel] });
    expect(first.created).toHaveLength(1);
    expect(sent).toHaveLength(1);
    expect(first.created[0]?.dispatchResults).toEqual([{ channel: "fake", ok: true }]);

    const second = await runReminderScan(db, { nowMinutes: FIXED_NOW_MINUTES + 5, channels: [fakeChannel] });
    expect(second.created).toHaveLength(0);
    expect(sent).toHaveLength(1); // 重複時は再送しない
  });

  it("skips a user without a resolvable settings timeline instead of throwing, and still scans the rest", async () => {
    const { db, tenantId, userId } = await setupTestDb();
    // setupSecondUser は work_policy を割り当てないユーザーを追加する(修正申請テスト用の元々の用途)。
    // buildSettingsTimeline がこのユーザーに対して例外を投げても、スキャン全体は落ちず
    // 他のユーザーの検知は継続されることを確認する。
    const second = await setupSecondUser(db, tenantId);

    const clockInAt = jstMinutes(2026, 4, 1, 9, 0);
    await insertPunchEvent(db, {
      tenantId,
      userId,
      kind: "clock_in",
      occurredAt: clockInAt,
      recordedAt: clockInAt,
      source: "web",
      actorId: userId,
    });

    const result = await runReminderScan(db, { nowMinutes: FIXED_NOW_MINUTES });

    expect(result.scannedUserCount).toBe(2);
    expect(result.created).toHaveLength(1);
    expect(result.created[0]?.notification.userId).toBe(userId);
    expect(await listNotifications(db, { tenantId, userId: second.userId })).toHaveLength(0);
  });
});
