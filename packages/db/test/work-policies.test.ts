import { beforeEach, describe, expect, it } from "vitest";
import {
  assignUserWorkPolicy,
  createWorkPolicy,
  getOrCreateTenantWorkPolicyByKind,
  getTenantWorkPolicy,
  getWorkPolicyById,
  listCurrentWorkPolicyAssignmentsForTenant,
  listCurrentWorkPolicyKindsForTenant,
  listTenantWorkPolicies,
  listUserPolicyAssignments,
  listWorkPolicyVersionsForTenant,
  renameWorkPolicy,
  setWorkPolicyArchivedAt,
} from "../src/queries/work-policies.js";
import { migrateDb, type Database } from "./support/db.js";
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
  describe("名前付きの制度(2026-10-05)", () => {
    const fixedVersion = (standardDayMinutes: number) => ({
      effectiveFrom: "2000-01-01",
      kind: "fixed",
      settlementPeriod: "monthly",
      core: null,
      standardDayMinutes,
    });

    it("createWorkPolicy creates the policy with its initial version; listTenantWorkPolicies returns them in creation order", async () => {
      const full = await createWorkPolicy(db, { tenantId, name: "固定(8時間)", createdAt: 10, initialVersion: fixedVersion(480) });
      const short = await createWorkPolicy(db, { tenantId, name: "固定・時短(6時間)", createdAt: 20, initialVersion: fixedVersion(360) });

      expect(short.version).toMatchObject({ workPolicyId: short.policy.id, kind: "fixed", standardDayMinutes: 360, createdAt: 20 });
      expect((await listTenantWorkPolicies(db, tenantId)).map((p) => p.name)).toEqual(["固定(8時間)", "固定・時短(6時間)"]);
      // 既定の制度 = 最も古い制度
      expect((await getTenantWorkPolicy(db, tenantId))?.id).toBe(full.policy.id);
      expect((await listWorkPolicyVersionsForTenant(db, tenantId)).map((v) => v.standardDayMinutes).sort()).toEqual([360, 480]);
    });

    it("renameWorkPolicy / setWorkPolicyArchivedAt update only the target tenant's row", async () => {
      const { policy } = await createWorkPolicy(db, { tenantId, name: "旧名", createdAt: 0, initialVersion: fixedVersion(360) });
      const otherTenantId = uuidv7();
      await db.insert(tenants).values({ id: otherTenantId, name: "Tenant B", createdAt: 0 });

      await renameWorkPolicy(db, { tenantId: otherTenantId, id: policy.id, name: "乗っ取り" });
      await renameWorkPolicy(db, { tenantId, id: policy.id, name: "新名" });
      await setWorkPolicyArchivedAt(db, { tenantId, id: policy.id, archivedAt: 123 });

      expect(await getWorkPolicyById(db, { tenantId, id: policy.id })).toMatchObject({ name: "新名", archivedAt: 123 });
      expect(await getWorkPolicyById(db, { tenantId: otherTenantId, id: policy.id })).toBeNull();
    });

    it("getOrCreateTenantWorkPolicyByKind picks the oldest non-archived policy of the kind, deterministically", async () => {
      const full = await createWorkPolicy(db, { tenantId, name: "固定(8時間)", createdAt: 10, initialVersion: fixedVersion(480) });
      // 版の日付が早い制度を後から作っても、選ばれるのは作成順で先の制度
      const short = await createWorkPolicy(db, {
        tenantId,
        name: "固定・時短(6時間)",
        createdAt: 20,
        initialVersion: { ...fixedVersion(360), effectiveFrom: "1970-01-01" },
      });
      const params = { tenantId, kind: "fixed", name: "x", createdAt: 30, defaultVersion: { settlementPeriod: "monthly", standardDayMinutes: 480 } };

      expect((await getOrCreateTenantWorkPolicyByKind(db, params)).id).toBe(full.policy.id);
      await setWorkPolicyArchivedAt(db, { tenantId, id: full.policy.id, archivedAt: 1 });
      expect((await getOrCreateTenantWorkPolicyByKind(db, params)).id).toBe(short.policy.id);
    });

    it("listCurrentWorkPolicyAssignmentsForTenant returns the policy id with the kind effective on asOfDate", async () => {
      const full = await createWorkPolicy(db, { tenantId, name: "固定(8時間)", createdAt: 10, initialVersion: fixedVersion(480) });
      const short = await createWorkPolicy(db, { tenantId, name: "固定・時短(6時間)", createdAt: 20, initialVersion: fixedVersion(360) });
      await assignUserWorkPolicy(db, { tenantId, userId, workPolicyId: full.policy.id, effectiveFrom: "2000-01-01", createdAt: 0 });
      await assignUserWorkPolicy(db, { tenantId, userId, workPolicyId: short.policy.id, effectiveFrom: "2026-05-01", createdAt: 0 });

      expect((await listCurrentWorkPolicyAssignmentsForTenant(db, { tenantId, asOfDate: "2026-04-30" })).get(userId)).toEqual({
        workPolicyId: full.policy.id,
        kind: "fixed",
      });
      expect((await listCurrentWorkPolicyAssignmentsForTenant(db, { tenantId, asOfDate: "2026-05-01" })).get(userId)).toEqual({
        workPolicyId: short.policy.id,
        kind: "fixed",
      });
    });
  });
});
