import { beforeEach, describe, expect, it } from "vitest";
import { migrateDb, type Database } from "../src/migrate.js";
import {
  createLeaveRequest,
  getLeaveRequest,
  getTenantLeaveSettings,
  insertLeaveGrant,
  listActiveLeaveRequestsForDate,
  listAllApprovedLeaveRequests,
  listApprovedLeaveRequestsInRange,
  listConvertedFromGrantIds,
  listGrantedOnDates,
  listLeaveGrants,
  listLeaveRequests,
  updateLeaveRequestStatus,
  upsertTenantLeaveSettings,
} from "../src/queries/leave.js";
import { tenantLeaveSettings, tenants, users } from "../src/schema/index.js";
import { uuidv7 } from "../src/uuid.js";

describe("leave queries", () => {
  let db: Database;
  const tenantId = uuidv7();
  const userId = uuidv7();

  beforeEach(async () => {
    ({ db } = await migrateDb());
    await db.insert(tenants).values({ id: tenantId, name: "Tenant A", createdAt: 0 });
    await db.insert(users).values({ id: userId, tenantId, email: "a@example.com", name: "A", createdAt: 0 });
  });

  describe("tenant_leave_settings", () => {
    it("returns null when unset, and upsert creates then updates in place", async () => {
      expect(await getTenantLeaveSettings(db, tenantId)).toBeNull();

      const created = await upsertTenantLeaveSettings(db, {
        tenantId,
        grantMethod: "statutory",
        fixedDateMmDd: null,
        hourlyLeaveEnabled: false,
        hourlyLeaveMaxDays: 5,
        halfDayLeaveEnabled: true,
        stockConversionEnabled: false,
        stockMaxDays: 40,
        stockExpiresMonths: null,
        updatedAt: 100,
        updatedBy: userId,
      });
      expect(created.grantMethod).toBe("statutory");

      const updated = await upsertTenantLeaveSettings(db, {
        tenantId,
        grantMethod: "fixed_date",
        fixedDateMmDd: "04-01",
        hourlyLeaveEnabled: true,
        hourlyLeaveMaxDays: 3,
        halfDayLeaveEnabled: true,
        stockConversionEnabled: true,
        stockMaxDays: 20,
        stockExpiresMonths: 60,
        updatedAt: 200,
        updatedBy: userId,
      });
      expect(updated.grantMethod).toBe("fixed_date");
      expect(updated.hourlyLeaveMaxDays).toBe(3);

      const all = await db.select().from(tenantLeaveSettings);
      expect(all).toHaveLength(1); // 1テナント1行(置き換え、追加ではない)
    });
  });

  describe("leave_grants", () => {
    it("insertLeaveGrant + listLeaveGrants orders by grantedOn ascending", async () => {
      await insertLeaveGrant(db, {
        tenantId,
        userId,
        leaveType: "annual",
        grantedOn: "2021-07-01",
        days: 11,
        expiresOn: "2023-07-01",
        source: "auto",
        createdAt: 0,
      });
      await insertLeaveGrant(db, {
        tenantId,
        userId,
        leaveType: "annual",
        grantedOn: "2020-07-01",
        days: 10,
        expiresOn: "2022-07-01",
        source: "auto",
        createdAt: 0,
      });

      const grants = await listLeaveGrants(db, { tenantId, userId });
      expect(grants.map((g) => g.grantedOn)).toEqual(["2020-07-01", "2021-07-01"]);
    });

    it("listGrantedOnDates supports auto-grant idempotency checks", async () => {
      await insertLeaveGrant(db, {
        tenantId,
        userId,
        leaveType: "annual",
        grantedOn: "2020-07-01",
        days: 10,
        expiresOn: "2022-07-01",
        source: "auto",
        createdAt: 0,
      });
      const dates = await listGrantedOnDates(db, { tenantId, userId });
      expect(dates.has("2020-07-01")).toBe(true);
      expect(dates.has("2021-07-01")).toBe(false);
    });

    it("listConvertedFromGrantIds tracks stock-conversion idempotency", async () => {
      const source = await insertLeaveGrant(db, {
        tenantId,
        userId,
        leaveType: "annual",
        grantedOn: "2020-07-01",
        days: 10,
        expiresOn: "2022-07-01",
        source: "auto",
        createdAt: 0,
      });
      await insertLeaveGrant(db, {
        tenantId,
        userId,
        leaveType: "stocked",
        grantedOn: "2022-07-01",
        days: 3,
        expiresOn: "9999-12-31",
        source: "conversion",
        convertedFromGrantId: source.id,
        createdAt: 0,
      });

      const converted = await listConvertedFromGrantIds(db, { tenantId, userId });
      expect(converted.has(source.id)).toBe(true);
    });

    it("allows multiple grants on the same date (no unique constraint — conversion batches may collide on date)", async () => {
      await insertLeaveGrant(db, {
        tenantId,
        userId,
        leaveType: "stocked",
        grantedOn: "2022-07-01",
        days: 2,
        expiresOn: "9999-12-31",
        source: "conversion",
        createdAt: 0,
      });
      await insertLeaveGrant(db, {
        tenantId,
        userId,
        leaveType: "stocked",
        grantedOn: "2022-07-01",
        days: 5,
        expiresOn: "9999-12-31",
        source: "conversion",
        createdAt: 0,
      });
      const grants = await listLeaveGrants(db, { tenantId, userId });
      expect(grants).toHaveLength(2);
    });
  });

  describe("leave_requests", () => {
    it("createLeaveRequest defaults status to pending", async () => {
      const req = await createLeaveRequest(db, {
        tenantId,
        userId,
        requestedBy: userId,
        leaveDate: "2026-04-10",
        unit: "full_day",
        leaveType: "annual",
        reason: "私用のため",
        createdAt: 0,
      });
      expect(req.status).toBe("pending");
      expect(await getLeaveRequest(db, req.id)).toMatchObject({ id: req.id });
    });

    it("listLeaveRequests filters by status", async () => {
      const a = await createLeaveRequest(db, {
        tenantId,
        userId,
        requestedBy: userId,
        leaveDate: "2026-04-10",
        unit: "full_day",
        leaveType: "annual",
        reason: "A",
        createdAt: 0,
      });
      await updateLeaveRequestStatus(db, { id: a.id, tenantId, status: "approved", decidedBy: userId, decidedAt: 1 });
      await createLeaveRequest(db, {
        tenantId,
        userId,
        requestedBy: userId,
        leaveDate: "2026-04-11",
        unit: "full_day",
        leaveType: "annual",
        reason: "B",
        createdAt: 1,
      });

      const pending = await listLeaveRequests(db, { tenantId, userId, status: "pending" });
      expect(pending).toHaveLength(1);
      expect(pending[0]?.leaveDate).toBe("2026-04-11");

      const approved = await listLeaveRequests(db, { tenantId, userId, status: "approved" });
      expect(approved).toHaveLength(1);
      expect(approved[0]?.id).toBe(a.id);
    });

    it("updateLeaveRequestStatus with fromStatus is a conditional update (optimistic lock)", async () => {
      const req = await createLeaveRequest(db, {
        tenantId,
        userId,
        requestedBy: userId,
        leaveDate: "2026-04-10",
        unit: "full_day",
        leaveType: "annual",
        reason: "A",
        createdAt: 0,
      });
      const first = await updateLeaveRequestStatus(db, { id: req.id, tenantId, fromStatus: "pending", status: "approved" });
      expect(first?.status).toBe("approved");

      // 既に approved なので pending からの遷移は失敗する(二重承認防止)
      const second = await updateLeaveRequestStatus(db, { id: req.id, tenantId, fromStatus: "pending", status: "approved" });
      expect(second).toBeNull();
    });

    it("listActiveLeaveRequestsForDate returns only pending/approved rows for that date", async () => {
      const rejected = await createLeaveRequest(db, {
        tenantId,
        userId,
        requestedBy: userId,
        leaveDate: "2026-04-10",
        unit: "half_day_am",
        leaveType: "annual",
        reason: "A",
        createdAt: 0,
      });
      await updateLeaveRequestStatus(db, { id: rejected.id, tenantId, status: "rejected" });
      await createLeaveRequest(db, {
        tenantId,
        userId,
        requestedBy: userId,
        leaveDate: "2026-04-10",
        unit: "half_day_pm",
        leaveType: "annual",
        reason: "B",
        createdAt: 1,
      });

      const active = await listActiveLeaveRequestsForDate(db, { tenantId, userId, leaveDate: "2026-04-10" });
      expect(active).toHaveLength(1);
      expect(active[0]?.unit).toBe("half_day_pm");
    });

    it("listApprovedLeaveRequestsInRange and listAllApprovedLeaveRequests only return approved rows", async () => {
      const inRange = await createLeaveRequest(db, {
        tenantId,
        userId,
        requestedBy: userId,
        leaveDate: "2026-04-10",
        unit: "full_day",
        leaveType: "annual",
        reason: "A",
        createdAt: 0,
      });
      await updateLeaveRequestStatus(db, { id: inRange.id, tenantId, status: "approved" });

      const outOfRange = await createLeaveRequest(db, {
        tenantId,
        userId,
        requestedBy: userId,
        leaveDate: "2026-05-10",
        unit: "full_day",
        leaveType: "annual",
        reason: "B",
        createdAt: 1,
      });
      await updateLeaveRequestStatus(db, { id: outOfRange.id, tenantId, status: "approved" });

      const stillPending = await createLeaveRequest(db, {
        tenantId,
        userId,
        requestedBy: userId,
        leaveDate: "2026-04-15",
        unit: "full_day",
        leaveType: "annual",
        reason: "C",
        createdAt: 2,
      });
      void stillPending;

      const ranged = await listApprovedLeaveRequestsInRange(db, { tenantId, userId, fromDate: "2026-04-01", toDate: "2026-04-30" });
      expect(ranged.map((r) => r.leaveDate)).toEqual(["2026-04-10"]);

      const all = await listAllApprovedLeaveRequests(db, { tenantId, userId });
      expect(all.map((r) => r.leaveDate)).toEqual(["2026-04-10", "2026-05-10"]);
    });
  });
});
