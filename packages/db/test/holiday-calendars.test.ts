import { beforeEach, describe, expect, it } from "vitest";
import { insertScheduledHolidayCalendarVersion, listScheduledHolidayCalendarVersions } from "../src/queries/holiday-calendars.js";
import { createWorkPolicy, listWorkPolicyVersionsForTenant } from "../src/queries/work-policies.js";
import { tenants, workPolicies, workPolicyVersions } from "../src/schema/index.js";
import { uuidv7 } from "../src/uuid.js";
import { migrateDb, type Database } from "./support/db.js";

describe("scheduled holiday calendar versions (所定休日のカレンダー)", () => {
  let db: Database;
  const tenantId = uuidv7();
  const otherTenantId = uuidv7();

  beforeEach(async () => {
    ({ db } = await migrateDb());
    await db.insert(tenants).values({ id: tenantId, name: "Tenant A", createdAt: 0 });
    await db.insert(tenants).values({ id: otherTenantId, name: "Tenant B", createdAt: 0 });
  });

  it("returns no versions for a tenant that has never saved a calendar (the engine default applies)", async () => {
    expect(await listScheduledHolidayCalendarVersions(db, tenantId)).toEqual([]);
  });

  it("appends versions and lists them in effective_from order, scoped to the tenant", async () => {
    await insertScheduledHolidayCalendarVersion(db, {
      tenantId,
      effectiveFrom: "2026-11-01",
      weekdays: "[0,6]",
      nationalHolidays: true,
      extraHolidays: '["2026-12-29","2026-12-30","2026-12-31"]',
      extraWorkdays: "[]",
      createdAt: 10,
    });
    await insertScheduledHolidayCalendarVersion(db, {
      tenantId,
      effectiveFrom: "2026-10-01",
      weekdays: "[0]",
      nationalHolidays: false,
      extraHolidays: "[]",
      extraWorkdays: '["2026-10-12"]',
      createdAt: 5,
    });
    await insertScheduledHolidayCalendarVersion(db, {
      tenantId: otherTenantId,
      effectiveFrom: "2026-01-01",
      weekdays: "[0,6]",
      nationalHolidays: true,
      extraHolidays: "[]",
      extraWorkdays: "[]",
      createdAt: 1,
    });

    const rows = await listScheduledHolidayCalendarVersions(db, tenantId);
    expect(rows.map((r) => r.effectiveFrom)).toEqual(["2026-10-01", "2026-11-01"]);
    expect(rows[0]?.nationalHolidays).toBe(false);
    expect(rows[1]?.nationalHolidays).toBe(true);
    expect(JSON.parse(rows[1]?.extraHolidays ?? "[]")).toEqual(["2026-12-29", "2026-12-30", "2026-12-31"]);
  });
});

describe("work_policy_versions flex contract columns", () => {
  let db: Database;
  const tenantId = uuidv7();

  beforeEach(async () => {
    ({ db } = await migrateDb());
    await db.insert(tenants).values({ id: tenantId, name: "Tenant A", createdAt: 0 });
  });

  it("defaults to the statutory frame without carry-over when inserted without the new columns (existing rows keep the old behaviour)", async () => {
    const policyId = uuidv7();
    await db.insert(workPolicies).values({ id: policyId, tenantId, name: "Flex", createdAt: 0 });
    await db.insert(workPolicyVersions).values({
      id: uuidv7(),
      tenantId,
      workPolicyId: policyId,
      effectiveFrom: "1970-01-01",
      kind: "flex",
      settlementPeriod: "monthly",
      core: null,
      standardDayMinutes: 480,
      createdAt: 0,
    });
    const [row] = await listWorkPolicyVersionsForTenant(db, tenantId);
    expect(row?.flexTotalHoursBasis).toBe("statutory_frame");
    expect(row?.flexCarryOverShortfall).toBe(false);
  });

  it("stores the scheduled-days basis and carry-over flag", async () => {
    const { version } = await createWorkPolicy(db, {
      tenantId,
      name: "フレックス・時短(6時間)",
      createdAt: 1,
      initialVersion: {
        effectiveFrom: "2026-10-01",
        kind: "flex",
        settlementPeriod: "monthly",
        core: null,
        standardDayMinutes: 360,
        flexTotalHoursBasis: "scheduled_days",
        flexCarryOverShortfall: true,
      },
    });
    expect(version.flexTotalHoursBasis).toBe("scheduled_days");
    expect(version.flexCarryOverShortfall).toBe(true);
  });
});
