import { beforeEach, describe, expect, it } from "vitest";
import { migrateDb, type Database } from "./support/db.js";
import {
  appendClosingEvent,
  getClosingSnapshotHistory,
  getClosingSnapshots,
  getClosingSnapshotsForUsers,
  getClosingState,
  getOriginalClosingSnapshots,
  getOriginalClosingSnapshotsForUsers,
  closePeriod,
  listClosingStates,
  reopenPeriod,
  saveClosingSnapshots,
  type NewClosingSnapshotInput,
} from "../src/queries/closings.js";
import { auditLogs, closingEvents, closingSnapshots, correctionRequests, tenants, users } from "../src/schema/index.js";
import { eq } from "drizzle-orm";
import { chunkRowsForInsert } from "../src/atomic.js";
import { uuidv7 } from "../src/uuid.js";

describe("closing_events / closing_snapshots", () => {
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

  /** amend の由来として参照できる、最小限の correction_requests 行を1件作る(FK 整合性のため)。 */
  async function insertDummyCorrectionRequest(): Promise<string> {
    const id = uuidv7();
    await db.insert(correctionRequests).values({
      id,
      tenantId,
      userId,
      requestedBy: userId,
      status: "approved",
      reason: "テスト用",
      createdAt: 0,
    });
    return id;
  }

  describe("getClosingState", () => {
    it("returns open with empty history when no events exist", async () => {
      const state = await getClosingState(db, { tenantId, period: "2026-04" });
      expect(state.status).toBe("open");
      expect(state.lastEvent).toBeNull();
      expect(state.history).toEqual([]);
    });

    it("becomes closed after a close event and reflects the actor/note", async () => {
      await appendClosingEvent(db, {
        tenantId,
        period: "2026-04",
        event: "close",
        actorId: userId,
        note: "月次確定",
        occurredAt: 1000,
      });

      const state = await getClosingState(db, { tenantId, period: "2026-04" });
      expect(state.status).toBe("closed");
      expect(state.lastEvent?.event).toBe("close");
      expect(state.lastEvent?.actorId).toBe(userId);
      expect(state.lastEvent?.note).toBe("月次確定");
      expect(state.history).toHaveLength(1);
    });

    it("reopen after close reverts status to open while keeping both events in history", async () => {
      await appendClosingEvent(db, { tenantId, period: "2026-04", event: "close", actorId: userId, occurredAt: 1000 });
      await appendClosingEvent(db, {
        tenantId,
        period: "2026-04",
        event: "reopen",
        actorId: otherUserId,
        note: "遡及修正のため",
        occurredAt: 2000,
      });

      const state = await getClosingState(db, { tenantId, period: "2026-04" });
      expect(state.status).toBe("open");
      expect(state.lastEvent?.event).toBe("reopen");
      expect(state.lastEvent?.actorId).toBe(otherUserId);
      expect(state.history.map((e) => e.event)).toEqual(["close", "reopen"]);
    });

    it("supports close -> reopen -> close (re-closing) with full history preserved", async () => {
      await appendClosingEvent(db, { tenantId, period: "2026-04", event: "close", actorId: userId, occurredAt: 1000 });
      await appendClosingEvent(db, { tenantId, period: "2026-04", event: "reopen", actorId: userId, occurredAt: 2000 });
      await appendClosingEvent(db, { tenantId, period: "2026-04", event: "close", actorId: userId, occurredAt: 3000 });

      const state = await getClosingState(db, { tenantId, period: "2026-04" });
      expect(state.status).toBe("closed");
      expect(state.history.map((e) => e.event)).toEqual(["close", "reopen", "close"]);
    });

    it("is scoped per period (other periods are unaffected)", async () => {
      await appendClosingEvent(db, { tenantId, period: "2026-04", event: "close", actorId: userId, occurredAt: 1000 });
      const marchState = await getClosingState(db, { tenantId, period: "2026-03" });
      expect(marchState.status).toBe("open");
    });
  });

  describe("listClosingStates", () => {
    it("enumerates every month in [from, to] even when some have no events", async () => {
      await appendClosingEvent(db, { tenantId, period: "2026-02", event: "close", actorId: userId, occurredAt: 1000 });

      const states = await listClosingStates(db, { tenantId, from: "2026-01", to: "2026-03" });
      expect(states.map((s) => s.period)).toEqual(["2026-01", "2026-02", "2026-03"]);
      expect(states.map((s) => s.status)).toEqual(["open", "closed", "open"]);
    });

    it("handles year boundaries", async () => {
      const states = await listClosingStates(db, { tenantId, from: "2025-12", to: "2026-02" });
      expect(states.map((s) => s.period)).toEqual(["2025-12", "2026-01", "2026-02"]);
    });
  });

  describe("saveClosingSnapshots / getClosingSnapshots", () => {
    it("returns snapshots tied to the latest close event for the period", async () => {
      const closeEvent = await appendClosingEvent(db, {
        tenantId,
        period: "2026-04",
        event: "close",
        actorId: userId,
        occurredAt: 1000,
      });

      await saveClosingSnapshots(db, [
        { tenantId, closingEventId: closeEvent.id, userId, category: "statutory", minutes: 9600 },
        { tenantId, closingEventId: closeEvent.id, userId, category: "overtime", minutes: 300 },
        { tenantId, closingEventId: closeEvent.id, userId, category: "flexDiff", minutes: -120 },
      ]);

      const snapshots = await getClosingSnapshots(db, { tenantId, period: "2026-04" });
      expect(snapshots).toHaveLength(3);
      const byCategory = Object.fromEntries(snapshots.map((s) => [s.category, s.minutes]));
      expect(byCategory.statutory).toBe(9600);
      expect(byCategory.overtime).toBe(300);
      expect(byCategory.flexDiff).toBe(-120);
    });

    it("returns an empty array when the period has never been closed", async () => {
      const snapshots = await getClosingSnapshots(db, { tenantId, period: "2026-05" });
      expect(snapshots).toEqual([]);
    });

    it("round-trips the fixed work system breakdown categories (fixedWithinScheduled / fixedExtraWithinStatutory)", async () => {
      const closeEvent = await appendClosingEvent(db, {
        tenantId,
        period: "2026-04",
        event: "close",
        actorId: userId,
        occurredAt: 1000,
      });

      await saveClosingSnapshots(db, [
        { tenantId, closingEventId: closeEvent.id, userId, category: "statutory", minutes: 9600 },
        { tenantId, closingEventId: closeEvent.id, userId, category: "fixedWithinScheduled", minutes: 8400 },
        { tenantId, closingEventId: closeEvent.id, userId, category: "fixedExtraWithinStatutory", minutes: 1200 },
      ]);

      const snapshots = await getClosingSnapshots(db, { tenantId, period: "2026-04" });
      const byCategory = Object.fromEntries(snapshots.map((s) => [s.category, s.minutes]));
      expect(byCategory.fixedWithinScheduled).toBe(8400);
      expect(byCategory.fixedExtraWithinStatutory).toBe(1200);
    });

    it("still returns the last close's snapshots after a reopen (no snapshot deletion on reopen)", async () => {
      const closeEvent = await appendClosingEvent(db, {
        tenantId,
        period: "2026-04",
        event: "close",
        actorId: userId,
        occurredAt: 1000,
      });
      await saveClosingSnapshots(db, [
        { tenantId, closingEventId: closeEvent.id, userId, category: "statutory", minutes: 100 },
      ]);
      await appendClosingEvent(db, { tenantId, period: "2026-04", event: "reopen", actorId: userId, occurredAt: 2000 });

      const snapshots = await getClosingSnapshots(db, { tenantId, period: "2026-04" });
      expect(snapshots).toHaveLength(1);
      expect(snapshots[0]?.minutes).toBe(100);
    });

    it("re-closing creates a fresh snapshot set tied to the new closing event (old snapshots untouched)", async () => {
      const firstClose = await appendClosingEvent(db, {
        tenantId,
        period: "2026-04",
        event: "close",
        actorId: userId,
        occurredAt: 1000,
      });
      await saveClosingSnapshots(db, [
        { tenantId, closingEventId: firstClose.id, userId, category: "statutory", minutes: 100 },
      ]);
      await appendClosingEvent(db, { tenantId, period: "2026-04", event: "reopen", actorId: userId, occurredAt: 2000 });
      const secondClose = await appendClosingEvent(db, {
        tenantId,
        period: "2026-04",
        event: "close",
        actorId: userId,
        occurredAt: 3000,
      });
      await saveClosingSnapshots(db, [
        { tenantId, closingEventId: secondClose.id, userId, category: "statutory", minutes: 200 },
      ]);

      const snapshots = await getClosingSnapshots(db, { tenantId, period: "2026-04" });
      expect(snapshots).toHaveLength(1);
      expect(snapshots[0]?.minutes).toBe(200);
      expect(snapshots[0]?.closingEventId).toBe(secondClose.id);
    });
  });

  describe("getClosingSnapshotsForUsers", () => {
    it("groups snapshots by user and only includes requested userIds", async () => {
      const closeEvent = await appendClosingEvent(db, {
        tenantId,
        period: "2026-04",
        event: "close",
        actorId: userId,
        occurredAt: 1000,
      });
      await saveClosingSnapshots(db, [
        { tenantId, closingEventId: closeEvent.id, userId, category: "statutory", minutes: 100 },
        { tenantId, closingEventId: closeEvent.id, userId: otherUserId, category: "statutory", minutes: 200 },
      ]);

      const map = await getClosingSnapshotsForUsers(db, { tenantId, period: "2026-04", userIds: [userId] });
      expect(map.size).toBe(1);
      expect(map.get(userId)).toHaveLength(1);
      expect(map.get(otherUserId)).toBeUndefined();
    });
  });

  describe("amend (締め後修正)", () => {
    /** close 1件 + 対象ユーザーのみを書き換える amend 1件、という共通の下ごしらえ。 */
    async function seedCloseThenAmend() {
      const closeEvent = await appendClosingEvent(db, {
        tenantId,
        period: "2026-04",
        event: "close",
        actorId: userId,
        occurredAt: 1000,
      });
      await saveClosingSnapshots(db, [
        { tenantId, closingEventId: closeEvent.id, userId, category: "statutory", minutes: 100 },
        { tenantId, closingEventId: closeEvent.id, userId, category: "overtime", minutes: 0 },
        { tenantId, closingEventId: closeEvent.id, userId: otherUserId, category: "statutory", minutes: 200 },
      ]);

      const amendEvent = await appendClosingEvent(db, {
        tenantId,
        period: "2026-04",
        event: "amend",
        actorId: userId,
        correctionRequestId: await insertDummyCorrectionRequest(),
        occurredAt: 2000,
      });
      // amend は影響を受けたユーザー(userId)の行だけを追加する(otherUserId の行は追加しない)
      await saveClosingSnapshots(db, [
        { tenantId, closingEventId: amendEvent.id, userId, category: "statutory", minutes: 160 },
        { tenantId, closingEventId: amendEvent.id, userId, category: "overtime", minutes: 0 },
      ]);

      return { closeEvent, amendEvent };
    }

    it("getClosingState keeps status='closed' after an amend event, with lastEvent reflecting the amend", async () => {
      await seedCloseThenAmend();

      const state = await getClosingState(db, { tenantId, period: "2026-04" });
      expect(state.status).toBe("closed");
      expect(state.lastEvent?.event).toBe("amend");
      expect(state.history.map((e) => e.event)).toEqual(["close", "amend"]);
    });

    it("getClosingSnapshots returns the amend generation for the amended user, and the original close generation for untouched users", async () => {
      const { amendEvent, closeEvent } = await seedCloseThenAmend();

      const snapshots = await getClosingSnapshots(db, { tenantId, period: "2026-04" });
      const byUser = new Map<string, typeof snapshots>();
      for (const s of snapshots) {
        byUser.set(s.userId, [...(byUser.get(s.userId) ?? []), s]);
      }

      const userRows = byUser.get(userId) ?? [];
      expect(userRows.every((r) => r.closingEventId === amendEvent.id)).toBe(true);
      expect(userRows.find((r) => r.category === "statutory")?.minutes).toBe(160);

      const otherRows = byUser.get(otherUserId) ?? [];
      expect(otherRows.every((r) => r.closingEventId === closeEvent.id)).toBe(true);
      expect(otherRows.find((r) => r.category === "statutory")?.minutes).toBe(200);
    });

    it("getOriginalClosingSnapshots always returns the first close's rows, unaffected by amend", async () => {
      await seedCloseThenAmend();

      const original = await getOriginalClosingSnapshots(db, { tenantId, period: "2026-04" });
      const userOriginal = original.filter((s) => s.userId === userId);
      expect(userOriginal.find((r) => r.category === "statutory")?.minutes).toBe(100);
      // otherUserId の行は close 時点のものがそのまま残る(amend 前後で original は不変)
      const otherOriginal = original.filter((s) => s.userId === otherUserId);
      expect(otherOriginal.find((r) => r.category === "statutory")?.minutes).toBe(200);
    });

    it("getOriginalClosingSnapshots is unaffected by a second amend (original stays pinned to the very first close)", async () => {
      const { closeEvent } = await seedCloseThenAmend();

      const secondAmend = await appendClosingEvent(db, {
        tenantId,
        period: "2026-04",
        event: "amend",
        actorId: userId,
        correctionRequestId: await insertDummyCorrectionRequest(),
        occurredAt: 3000,
      });
      await saveClosingSnapshots(db, [
        { tenantId, closingEventId: secondAmend.id, userId, category: "statutory", minutes: 220 },
      ]);

      const original = await getOriginalClosingSnapshots(db, { tenantId, period: "2026-04" });
      expect(original.find((r) => r.userId === userId && r.category === "statutory")?.minutes).toBe(100);

      const current = await getClosingSnapshots(db, { tenantId, period: "2026-04" });
      const currentUserStatutory = current.find((r) => r.userId === userId && r.category === "statutory");
      expect(currentUserStatutory?.minutes).toBe(220);
      expect(currentUserStatutory?.closingEventId).toBe(secondAmend.id);
      expect(currentUserStatutory?.closingEventId).not.toBe(closeEvent.id);
    });

    it("getClosingSnapshotHistory returns generations in chronological order, each holding only the rows added at that event", async () => {
      const { closeEvent, amendEvent } = await seedCloseThenAmend();

      const history = await getClosingSnapshotHistory(db, { tenantId, period: "2026-04" });
      expect(history).toHaveLength(2);
      expect(history[0]?.event.id).toBe(closeEvent.id);
      expect(history[0]?.event.event).toBe("close");
      expect(history[0]?.snapshots).toHaveLength(3); // userId(statutory+overtime) 2件 + otherUserId(statutory) 1件
      expect(history[1]?.event.id).toBe(amendEvent.id);
      expect(history[1]?.event.event).toBe("amend");
      expect(history[1]?.event.correctionRequestId).not.toBeNull();
      // amend の行は影響ユーザー(userId)分のみ
      expect(history[1]?.snapshots.every((s) => s.userId === userId)).toBe(true);
      expect(history[1]?.snapshots).toHaveLength(2);
    });

    it("returns an empty generation list when the period has never been closed", async () => {
      const history = await getClosingSnapshotHistory(db, { tenantId, period: "2026-09" });
      expect(history).toEqual([]);
      const original = await getOriginalClosingSnapshots(db, { tenantId, period: "2026-09" });
      expect(original).toEqual([]);
    });
  });

  describe("getOriginalClosingSnapshotsForUsers", () => {
    it("groups the original (first close) snapshots by user and only includes requested userIds", async () => {
      const closeEvent = await appendClosingEvent(db, {
        tenantId,
        period: "2026-04",
        event: "close",
        actorId: userId,
        occurredAt: 1000,
      });
      await saveClosingSnapshots(db, [
        { tenantId, closingEventId: closeEvent.id, userId, category: "statutory", minutes: 100 },
        { tenantId, closingEventId: closeEvent.id, userId: otherUserId, category: "statutory", minutes: 200 },
      ]);
      const amendEvent = await appendClosingEvent(db, {
        tenantId,
        period: "2026-04",
        event: "amend",
        actorId: userId,
        correctionRequestId: await insertDummyCorrectionRequest(),
        occurredAt: 2000,
      });
      await saveClosingSnapshots(db, [
        { tenantId, closingEventId: amendEvent.id, userId, category: "statutory", minutes: 160 },
      ]);

      const map = await getOriginalClosingSnapshotsForUsers(db, { tenantId, period: "2026-04", userIds: [userId] });
      expect(map.size).toBe(1);
      expect(map.get(userId)?.[0]?.minutes).toBe(100); // amend 前(当初)の値
      expect(map.get(otherUserId)).toBeUndefined();
    });
  });

  // 締め/解除の書き込み(atomic plan、2026-10-07)。3レグ(D1 含む)で走る。
  // 以前の route 内トランザクションは「読み直してから追記」で、PostgreSQL では同時の2件が
  // 両方とも締められた(TOCTOU)。ここでは条件付き insert + ガードで「勝つのは1件だけ・
  // 負けた側は何も書かない」ことを固定する。
  describe("closePeriod / reopenPeriod", () => {
    const period = "2026-05";
    const snapshotsFor = (closingEventId: string): NewClosingSnapshotInput[] => [
      { tenantId, closingEventId, userId, category: "statutory", minutes: 100 },
      { tenantId, closingEventId, userId: otherUserId, category: "statutory", minutes: 200 },
    ];
    const close = (occurredAt: number, note: string | null = null) =>
      closePeriod(db, {
        tenantId,
        period,
        actorId: userId,
        note,
        occurredAt,
        buildSnapshots: snapshotsFor,
        audit: { action: "closing.close", targetType: "closing", targetId: period, detail: JSON.stringify({ note }) },
      });
    const reopen = (occurredAt: number) =>
      reopenPeriod(db, {
        tenantId,
        period,
        actorId: userId,
        note: null,
        occurredAt,
        audit: { action: "closing.reopen", targetType: "closing", targetId: period, detail: "{}" },
      });
    const auditActions = async () =>
      (await db.select().from(auditLogs).where(eq(auditLogs.tenantId, tenantId))).map((l) => l.action).sort();

    it("closes an open period: close event + snapshots tied to it + audit log, all at once", async () => {
      const result = await close(1000, "月末締め");
      if (!result.ok) throw new Error("expected close to succeed");
      expect(result.event).toMatchObject({ event: "close", period, note: "月末締め", occurredAt: 1000, correctionRequestId: null });

      const state = await getClosingState(db, { tenantId, period });
      expect(state.status).toBe("closed");
      const snapshots = await getClosingSnapshots(db, { tenantId, period });
      expect(snapshots.map((s) => [s.closingEventId, s.userId, s.minutes]).sort()).toEqual(
        [
          [result.event.id, userId, 100],
          [result.event.id, otherUserId, 200],
        ].sort(),
      );
      expect(await auditActions()).toEqual(["closing.close"]);
    });

    it("closing an already-closed period fails with already_closed and writes nothing", async () => {
      expect((await close(1000)).ok).toBe(true);
      expect(await close(1100)).toEqual({ ok: false, reason: "already_closed" });

      expect(await db.select().from(closingEvents).where(eq(closingEvents.tenantId, tenantId))).toHaveLength(1);
      expect(await db.select().from(closingSnapshots).where(eq(closingSnapshots.tenantId, tenantId))).toHaveLength(2);
      expect(await auditActions()).toEqual(["closing.close"]);
    });

    it("an amend after close does not reopen the period (close -> amend -> close is still already_closed)", async () => {
      const closed = await close(1000);
      if (!closed.ok) throw new Error("expected close to succeed");
      await appendClosingEvent(db, {
        tenantId,
        period,
        event: "amend",
        actorId: userId,
        correctionRequestId: await insertDummyCorrectionRequest(),
        occurredAt: 1500,
      });
      expect(await close(2000)).toEqual({ ok: false, reason: "already_closed" });
    });

    it("reopen requires a closed period (not_closed writes nothing); close -> reopen -> close works", async () => {
      expect(await reopen(500)).toEqual({ ok: false, reason: "not_closed" });
      expect(await auditActions()).toEqual([]);

      expect((await close(1000)).ok).toBe(true);
      const reopened = await reopen(1100);
      expect(reopened.ok && reopened.event.event).toBe("reopen");
      expect((await getClosingState(db, { tenantId, period })).status).toBe("open");
      expect(await reopen(1150)).toEqual({ ok: false, reason: "not_closed" });

      const reclosed = await close(1200);
      expect(reclosed.ok).toBe(true);
      const state = await getClosingState(db, { tenantId, period });
      expect(state.history.map((e) => e.event)).toEqual(["close", "reopen", "close"]);
      expect(await auditActions()).toEqual(["closing.close", "closing.close", "closing.reopen"]);
    });

    it("concurrent closes of the same period: exactly one wins; the loser writes no event, snapshot or audit log", async () => {
      const results = await Promise.all([close(1000, "a"), close(1000, "b"), close(1000, "c")]);
      expect(results.filter((r) => r.ok)).toHaveLength(1);
      expect(results.filter((r) => !r.ok)).toEqual([
        { ok: false, reason: "already_closed" },
        { ok: false, reason: "already_closed" },
      ]);

      const events = await db.select().from(closingEvents).where(eq(closingEvents.tenantId, tenantId));
      expect(events).toHaveLength(1);
      const snapshots = await db.select().from(closingSnapshots).where(eq(closingSnapshots.tenantId, tenantId));
      expect(snapshots).toHaveLength(2);
      expect(new Set(snapshots.map((s) => s.closingEventId))).toEqual(new Set([events[0]?.id]));
      expect(await auditActions()).toEqual(["closing.close"]);
    });

    it("concurrent reopens: exactly one wins", async () => {
      expect((await close(1000)).ok).toBe(true);
      const results = await Promise.all([reopen(1100), reopen(1100)]);
      expect(results.filter((r) => r.ok)).toHaveLength(1);
      const events = await db.select().from(closingEvents).where(eq(closingEvents.tenantId, tenantId));
      expect(events.map((e) => e.event).sort()).toEqual(["close", "reopen"]);
      expect(await auditActions()).toEqual(["closing.close", "closing.reopen"]);
    });

    it("saves many snapshots in one close (split under D1's 100 bound parameters per statement)", async () => {
      const manyUsers = Array.from({ length: 30 }, (_, i) => ({
        id: uuidv7(),
        tenantId,
        email: `bulk-${i}@example.com`,
        name: `Bulk ${i}`,
        createdAt: 0,
      }));
      // 下ごしらえも D1 の上限に引っかかる(users は 11 列)ので同じ割り方で入れる
      for (const chunk of chunkRowsForInsert(users, manyUsers)) await db.insert(users).values(chunk);
      const categories = ["statutory", "overtime", "overtime60h", "lateNight", "statutoryHoliday", "flexFrame", "flexActual", "flexDiff"] as const;

      const result = await closePeriod(db, {
        tenantId,
        period,
        actorId: userId,
        note: null,
        occurredAt: 1000,
        buildSnapshots: (closingEventId) =>
          manyUsers.flatMap((u, i) => categories.map((category) => ({ tenantId, closingEventId, userId: u.id, category, minutes: i }))),
        audit: { action: "closing.close", targetType: "closing", targetId: period, detail: "{}" },
      });
      expect(result.ok).toBe(true);
      // 30 人 × 8 区分 = 240 行(1文に入れると 1440 個のバインド変数)
      expect(await getClosingSnapshots(db, { tenantId, period })).toHaveLength(240);
    });
  });
});
