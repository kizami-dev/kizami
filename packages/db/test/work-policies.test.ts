import { beforeEach, describe, expect, it } from "vitest";
import {
  assignUserWorkPolicy,
  getOrCreateTenantWorkPolicyByKind,
  listCurrentWorkPolicyKindsForTenant,
  listUserPolicyAssignments,
} from "../src/queries/work-policies.js";
import { migrateDb, type Database } from "../src/migrate.js";
import { tenants, users, workPolicies, workPolicyVersions } from "../src/schema/index.js";
import { uuidv7 } from "../src/uuid.js";

describe("work-policies queries (メンバー個別の労働時間制割当)", () => {
  let db: Database;
  const tenantId = uuidv7();
  const userId = uuidv7();

  beforeEach(async () => {
    ({ db } = await migrateDb());
    await db.insert(tenants).values({ id: tenantId, name: "Tenant A", createdAt: 0 });
    await db.insert(users).values({ id: userId, tenantId, email: "a@example.com", name: "User A", isActive: true, createdAt: 0 });
  });

  describe("getOrCreateTenantWorkPolicyByKind", () => {
    it("creates a new policy + initial version when none matches the kind", async () => {
      const policy = await getOrCreateTenantWorkPolicyByKind(db, {
        tenantId,
        kind: "fixed",
        name: "標準(固定時間制)",
        createdAt: 100,
        defaultVersion: { settlementPeriod: "monthly", standardDayMinutes: 480 },
      });

      expect(policy.name).toBe("標準(固定時間制)");
      const rows = await db.select().from(workPolicyVersions);
      const created = rows.find((r) => r.workPolicyId === policy.id);
      expect(created?.kind).toBe("fixed");
      expect(created?.effectiveFrom).toBe("1970-01-01");
      expect(created?.standardDayMinutes).toBe(480);
    });

    it("reuses an existing policy whose latest version's kind matches", async () => {
      const existingId = uuidv7();
      await db.insert(workPolicies).values({ id: existingId, tenantId, name: "Flex", createdAt: 0 });
      await db.insert(workPolicyVersions).values({
        id: uuidv7(),
        tenantId,
        workPolicyId: existingId,
        effectiveFrom: "1970-01-01",
        kind: "flex",
        settlementPeriod: "monthly",
        core: null,
        standardDayMinutes: 480,
        createdAt: 0,
      });

      const policy = await getOrCreateTenantWorkPolicyByKind(db, {
        tenantId,
        kind: "flex",
        name: "標準",
        createdAt: 100,
        defaultVersion: { settlementPeriod: "monthly", standardDayMinutes: 999 },
      });

      expect(policy.id).toBe(existingId);
      // defaultVersion は既存ポリシーが見つかった場合は無視される(新版は作られない)
      const versionRows = await db.select().from(workPolicyVersions);
      expect(versionRows.filter((r) => r.workPolicyId === existingId)).toHaveLength(1);
    });

    it("does not match a policy whose latest version's kind differs", async () => {
      const flexPolicyId = uuidv7();
      await db.insert(workPolicies).values({ id: flexPolicyId, tenantId, name: "標準", createdAt: 0 });
      await db.insert(workPolicyVersions).values({
        id: uuidv7(),
        tenantId,
        workPolicyId: flexPolicyId,
        effectiveFrom: "1970-01-01",
        kind: "flex",
        settlementPeriod: "monthly",
        core: null,
        standardDayMinutes: 480,
        createdAt: 0,
      });

      const fixedPolicy = await getOrCreateTenantWorkPolicyByKind(db, {
        tenantId,
        kind: "fixed",
        name: "標準(固定時間制)",
        createdAt: 100,
        defaultVersion: { settlementPeriod: "monthly", standardDayMinutes: 480 },
      });

      expect(fixedPolicy.id).not.toBe(flexPolicyId);
    });
  });

  describe("listUserPolicyAssignments", () => {
    it("returns assignment history with policy name and the kind effective at each assignment's date", async () => {
      const flexPolicy = await getOrCreateTenantWorkPolicyByKind(db, {
        tenantId,
        kind: "flex",
        name: "標準",
        createdAt: 0,
        defaultVersion: { settlementPeriod: "monthly", standardDayMinutes: 480 },
      });
      const fixedPolicy = await getOrCreateTenantWorkPolicyByKind(db, {
        tenantId,
        kind: "fixed",
        name: "標準(固定時間制)",
        createdAt: 0,
        defaultVersion: { settlementPeriod: "monthly", standardDayMinutes: 480 },
      });

      await assignUserWorkPolicy(db, { tenantId, userId, workPolicyId: flexPolicy.id, effectiveFrom: "1970-01-01", createdAt: 0 });
      await assignUserWorkPolicy(db, { tenantId, userId, workPolicyId: fixedPolicy.id, effectiveFrom: "2026-06-01", createdAt: 10 });

      const history = await listUserPolicyAssignments(db, { tenantId, userId });
      expect(history.map((h) => h.effectiveFrom)).toEqual(["1970-01-01", "2026-06-01"]);
      expect(history[0]?.kind).toBe("flex");
      expect(history[0]?.workPolicyName).toBe("標準");
      expect(history[1]?.kind).toBe("fixed");
      expect(history[1]?.workPolicyName).toBe("標準(固定時間制)");
    });

    it("returns an empty array when the user has no assignment", async () => {
      const history = await listUserPolicyAssignments(db, { tenantId, userId });
      expect(history).toEqual([]);
    });
  });

  describe("listCurrentWorkPolicyKindsForTenant", () => {
    it("resolves the effective kind per user as of asOfDate, in two queries regardless of user count", async () => {
      const secondUserId = uuidv7();
      await db.insert(users).values({ id: secondUserId, tenantId, email: "b@example.com", name: "User B", isActive: true, createdAt: 0 });

      const flexPolicy = await getOrCreateTenantWorkPolicyByKind(db, {
        tenantId,
        kind: "flex",
        name: "標準",
        createdAt: 0,
        defaultVersion: { settlementPeriod: "monthly", standardDayMinutes: 480 },
      });
      const fixedPolicy = await getOrCreateTenantWorkPolicyByKind(db, {
        tenantId,
        kind: "fixed",
        name: "標準(固定時間制)",
        createdAt: 0,
        defaultVersion: { settlementPeriod: "monthly", standardDayMinutes: 480 },
      });

      await assignUserWorkPolicy(db, { tenantId, userId, workPolicyId: flexPolicy.id, effectiveFrom: "1970-01-01", createdAt: 0 });
      // 未来日の割当。asOfDate がその日より前なら反映されない。
      await assignUserWorkPolicy(db, { tenantId, userId, workPolicyId: fixedPolicy.id, effectiveFrom: "2099-01-01", createdAt: 0 });
      // secondUserId は割当なし。

      const kindsToday = await listCurrentWorkPolicyKindsForTenant(db, { tenantId, asOfDate: "2026-08-23" });
      expect(kindsToday.get(userId)).toBe("flex");
      expect(kindsToday.has(secondUserId)).toBe(false);

      const kindsFuture = await listCurrentWorkPolicyKindsForTenant(db, { tenantId, asOfDate: "2099-06-01" });
      expect(kindsFuture.get(userId)).toBe("fixed");
    });
  });
});
