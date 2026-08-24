import { beforeEach, describe, expect, it } from "vitest";
import {
  archiveShiftPattern,
  getShiftPlanById,
  getValidShiftDayForDate,
  insertShiftPattern,
  insertShiftPlan,
  listShiftDayHistoryForPlan,
  listShiftPatterns,
  listValidShiftDaysForPlan,
  listValidShiftDaysInRange,
  publishShiftPlan,
  upsertShiftDaysForPlan,
} from "../src/queries/shifts.js";
import { migrateDb, type Database } from "./support/db.js";
import { tenants, users } from "../src/schema/index.js";
import { uuidv7 } from "../src/uuid.js";

describe("shift_patterns / shift_plans / shift_days", () => {
  let db: Database;
  const tenantId = uuidv7();
  const userId = uuidv7();

  beforeEach(async () => {
    ({ db } = await migrateDb());
    await db.insert(tenants).values({ id: tenantId, name: "Tenant A", createdAt: 0 });
    await db.insert(users).values({ id: userId, tenantId, email: "a@example.com", name: "A", createdAt: 0 });
  });

  describe("shift_patterns", () => {
    it("inserts, lists (excluding archived by default), and archives", async () => {
      const early = await insertShiftPattern(db, {
        tenantId,
        name: "早番",
        dayType: "work",
        startMinutes: 480,
        endMinutes: 960,
        breakMinutes: 60,
        createdAt: 0,
      });
      const rest = await insertShiftPattern(db, {
        tenantId,
        name: "休み",
        dayType: "non_working",
        startMinutes: 0,
        endMinutes: 0,
        breakMinutes: 0,
        createdAt: 0,
      });

      expect((await listShiftPatterns(db, { tenantId })).map((p) => p.id).sort()).toEqual([early.id, rest.id].sort());

      const archived = await archiveShiftPattern(db, { tenantId, id: early.id, archivedAt: 100 });
      expect(archived?.archivedAt).toBe(100);

      expect((await listShiftPatterns(db, { tenantId })).map((p) => p.id)).toEqual([rest.id]);
      expect((await listShiftPatterns(db, { tenantId, includeArchived: true })).map((p) => p.id).sort()).toEqual(
        [early.id, rest.id].sort(),
      );

      // 二重アーカイブは null
      expect(await archiveShiftPattern(db, { tenantId, id: early.id, archivedAt: 200 })).toBeNull();
    });
  });

  describe("shift_plans + shift_days: supersede と有効行の解決", () => {
    it("upsertShiftDaysForPlan は初回挿入では supersedesId が null", async () => {
      const plan = await insertShiftPlan(db, { tenantId, userId, periodStart: "2026-09-16", periodEnd: "2026-10-15", createdAt: 0 });

      const rows = await upsertShiftDaysForPlan(db, {
        tenantId,
        userId,
        planId: plan.id,
        days: [
          { date: "2026-09-16", dayType: "work", startMinutes: 540, endMinutes: 1080, breakMinutes: 60, patternId: null },
          { date: "2026-09-17", dayType: "legal_holiday", startMinutes: 0, endMinutes: 0, breakMinutes: 0, patternId: null },
        ],
        createdBy: userId,
        createdAt: 100,
      });

      expect(rows).toHaveLength(2);
      expect(rows.every((r) => r.supersedesId === null)).toBe(true);

      const valid = await listValidShiftDaysInRange(db, { tenantId, userId, fromDate: "2026-09-16", toDate: "2026-09-17" });
      expect(valid.map((r) => r.date)).toEqual(["2026-09-16", "2026-09-17"]);
    });

    it("同じ日付への再 upsert は supersede チェーンを積み、有効行だけが listValidShiftDaysInRange に残る", async () => {
      const plan = await insertShiftPlan(db, { tenantId, userId, periodStart: "2026-09-16", periodEnd: "2026-10-15", createdAt: 0 });

      const [first] = await upsertShiftDaysForPlan(db, {
        tenantId,
        userId,
        planId: plan.id,
        days: [{ date: "2026-09-16", dayType: "work", startMinutes: 540, endMinutes: 1080, breakMinutes: 60, patternId: null }],
        createdBy: userId,
        createdAt: 100,
      });

      // 確定後の訂正: 開始・終了を変更する新しい行を積む
      const [second] = await upsertShiftDaysForPlan(db, {
        tenantId,
        userId,
        planId: plan.id,
        days: [{ date: "2026-09-16", dayType: "work", startMinutes: 600, endMinutes: 1140, breakMinutes: 60, patternId: null }],
        createdBy: userId,
        createdAt: 200,
      });

      expect(second?.supersedesId).toBe(first?.id);

      const valid = await getValidShiftDayForDate(db, { tenantId, userId, date: "2026-09-16" });
      expect(valid?.id).toBe(second?.id);
      expect(valid?.startMinutes).toBe(600);

      const inRange = await listValidShiftDaysInRange(db, { tenantId, userId, fromDate: "2026-09-01", toDate: "2026-09-30" });
      expect(inRange).toHaveLength(1);
      expect(inRange[0]?.id).toBe(second?.id);

      // 履歴には両方残る
      const history = await listShiftDayHistoryForPlan(db, { tenantId, planId: plan.id });
      expect(history.map((r) => r.id)).toEqual([first?.id, second?.id]);
    });

    it("listValidShiftDaysForPlan は有効行のみ・別 plan の日付は含めない", async () => {
      const plan = await insertShiftPlan(db, { tenantId, userId, periodStart: "2026-09-16", periodEnd: "2026-10-15", createdAt: 0 });
      const otherPlan = await insertShiftPlan(db, { tenantId, userId, periodStart: "2026-08-16", periodEnd: "2026-09-15", createdAt: 0 });

      await upsertShiftDaysForPlan(db, {
        tenantId,
        userId,
        planId: plan.id,
        days: [{ date: "2026-09-20", dayType: "work", startMinutes: 540, endMinutes: 1080, breakMinutes: 60, patternId: null }],
        createdBy: userId,
        createdAt: 0,
      });
      await upsertShiftDaysForPlan(db, {
        tenantId,
        userId,
        planId: otherPlan.id,
        days: [{ date: "2026-09-01", dayType: "work", startMinutes: 540, endMinutes: 1080, breakMinutes: 60, patternId: null }],
        createdBy: userId,
        createdAt: 0,
      });

      const forPlan = await listValidShiftDaysForPlan(db, { tenantId, planId: plan.id });
      expect(forPlan.map((r) => r.date)).toEqual(["2026-09-20"]);
    });
  });

  describe("publishShiftPlan", () => {
    it("未確定の plan を確定でき、二重確定は null", async () => {
      const plan = await insertShiftPlan(db, { tenantId, userId, periodStart: "2026-09-16", periodEnd: "2026-10-15", createdAt: 0 });
      expect(plan.publishedAt).toBeNull();

      const published = await publishShiftPlan(db, { tenantId, id: plan.id, publishedAt: 500, publishedBy: userId });
      expect(published?.publishedAt).toBe(500);
      expect(published?.publishedBy).toBe(userId);

      const reFetched = await getShiftPlanById(db, { tenantId, id: plan.id });
      expect(reFetched?.publishedAt).toBe(500);

      expect(await publishShiftPlan(db, { tenantId, id: plan.id, publishedAt: 600, publishedBy: userId })).toBeNull();
    });
  });
});
