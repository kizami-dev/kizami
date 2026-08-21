import { beforeEach, describe, expect, it } from "vitest";
import { getEffectiveSettingsVersion, getSettingsTimeline } from "../src/queries/settings.js";
import { migrateDb, type Database } from "../src/migrate.js";
import { tenantSettingVersions, tenants } from "../src/schema/index.js";
import { uuidv7 } from "../src/uuid.js";

describe("tenant_setting_versions", () => {
  let db: Database;
  const tenantId = uuidv7();

  const versionIds = {
    jan: uuidv7(),
    apr: uuidv7(),
    jul: uuidv7(),
  };

  beforeEach(async () => {
    ({ db } = await migrateDb());
    await db.insert(tenants).values({ id: tenantId, name: "Tenant A", createdAt: 0 });

    await db.insert(tenantSettingVersions).values([
      {
        id: versionIds.jan,
        tenantId,
        effectiveFrom: "2026-01-01",
        dayBoundaryMinutes: 0,
        legalHolidayRule: JSON.stringify({ kind: "weekday", weekday: 0 }),
        breakRule: JSON.stringify({ mode: "punch" }),
        gpsEnabled: false,
        gpsRetentionDays: null,
        createdAt: 0,
      },
      {
        id: versionIds.apr,
        tenantId,
        effectiveFrom: "2026-04-01",
        dayBoundaryMinutes: 300,
        legalHolidayRule: JSON.stringify({ kind: "weekday", weekday: 0 }),
        breakRule: JSON.stringify({ mode: "punch" }),
        gpsEnabled: true,
        gpsRetentionDays: 90,
        createdAt: 1,
      },
      {
        id: versionIds.jul,
        tenantId,
        effectiveFrom: "2026-07-01",
        dayBoundaryMinutes: 300,
        legalHolidayRule: JSON.stringify({ kind: "weekday", weekday: 0 }),
        breakRule: JSON.stringify({ mode: "both" }),
        gpsEnabled: true,
        gpsRetentionDays: null,
        createdAt: 2,
      },
    ]);
  });

  describe("getEffectiveSettingsVersion", () => {
    it("returns the latest version at or before onDate", async () => {
      const v = await getEffectiveSettingsVersion(db, { tenantId, onDate: "2026-03-15" });
      expect(v?.id).toBe(versionIds.jan);
    });

    it("is inclusive of the boundary date (effective_from == onDate)", async () => {
      const v = await getEffectiveSettingsVersion(db, { tenantId, onDate: "2026-04-01" });
      expect(v?.id).toBe(versionIds.apr);
    });

    it("returns the latest applicable version even when onDate is far in the future", async () => {
      const v = await getEffectiveSettingsVersion(db, { tenantId, onDate: "2099-01-01" });
      expect(v?.id).toBe(versionIds.jul);
    });

    it("returns null when no version is effective yet", async () => {
      const v = await getEffectiveSettingsVersion(db, { tenantId, onDate: "2025-12-31" });
      expect(v).toBeNull();
    });
  });

  describe("getSettingsTimeline", () => {
    it("returns the latest version before the period plus versions within the period, ascending", async () => {
      const timeline = await getSettingsTimeline(db, { tenantId, fromDate: "2026-02-01", toDate: "2026-05-01" });
      expect(timeline.map((v) => v.id)).toEqual([versionIds.jan, versionIds.apr]);
      expect(timeline.map((v) => v.effectiveFrom)).toEqual(["2026-01-01", "2026-04-01"]);
    });

    it("does not duplicate a version whose effective_from equals fromDate exactly", async () => {
      const timeline = await getSettingsTimeline(db, { tenantId, fromDate: "2026-04-01", toDate: "2026-04-01" });
      expect(timeline.map((v) => v.id)).toEqual([versionIds.apr]);
    });

    it("includes all versions spanning a wider period", async () => {
      const timeline = await getSettingsTimeline(db, { tenantId, fromDate: "2026-01-15", toDate: "2026-12-31" });
      expect(timeline.map((v) => v.id)).toEqual([versionIds.jan, versionIds.apr, versionIds.jul]);
    });
  });
});
