import { beforeEach, describe, expect, it } from "vitest";
import { migrateDb, type Database } from "../src/migrate.js";
import {
  appendClosingEvent,
  getClosingSnapshots,
  getClosingSnapshotsForUsers,
  getClosingState,
  listClosingStates,
  saveClosingSnapshots,
} from "../src/queries/closings.js";
import { tenants, users } from "../src/schema/index.js";
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
});
