import { beforeEach, describe, expect, it } from "vitest";
import {
  createAllowanceDefinition,
  getAllowanceDefinitionVersionsTimeline,
  insertAllowanceDefinitionVersion,
  listAllowanceDefinitions,
  listAllowanceDefinitionVersions,
} from "../src/queries/allowances.js";
import { migrateDb, type Database } from "../src/migrate.js";
import { tenants } from "../src/schema/index.js";
import { uuidv7 } from "../src/uuid.js";

describe("allowance_definitions / allowance_definition_versions", () => {
  let db: Database;
  const tenantId = uuidv7();

  beforeEach(async () => {
    ({ db } = await migrateDb());
    await db.insert(tenants).values({ id: tenantId, name: "Tenant A", createdAt: 0 });
  });

  describe("createAllowanceDefinition / listAllowanceDefinitions", () => {
    it("creates a definition with its first version in one call", async () => {
      const { definition, version } = await createAllowanceDefinition(db, {
        tenantId,
        effectiveFrom: "2026-01-01",
        name: "早朝手当",
        conditions: JSON.stringify({ timeBand: { startMinutes: 360, endMinutes: 480 } }),
        createdAt: 0,
      });

      expect(version.definitionId).toBe(definition.id);
      expect(version.name).toBe("早朝手当");

      const definitions = await listAllowanceDefinitions(db, tenantId);
      expect(definitions.map((d) => d.id)).toEqual([definition.id]);
    });

    it("lists multiple definitions for the same tenant", async () => {
      await createAllowanceDefinition(db, { tenantId, effectiveFrom: "2026-01-01", name: "A", conditions: "{}", createdAt: 0 });
      await createAllowanceDefinition(db, { tenantId, effectiveFrom: "2026-01-01", name: "B", conditions: "{}", createdAt: 1 });

      const definitions = await listAllowanceDefinitions(db, tenantId);
      expect(definitions).toHaveLength(2);
    });
  });

  describe("insertAllowanceDefinitionVersion / listAllowanceDefinitionVersions", () => {
    it("appends a new version without touching the existing one", async () => {
      const { definition } = await createAllowanceDefinition(db, {
        tenantId,
        effectiveFrom: "2026-01-01",
        name: "早朝手当",
        conditions: JSON.stringify({ timeBand: { startMinutes: 360, endMinutes: 480 } }),
        createdAt: 0,
      });
      await insertAllowanceDefinitionVersion(db, {
        tenantId,
        definitionId: definition.id,
        effectiveFrom: "2026-04-01",
        name: "早朝手当(改定)",
        conditions: JSON.stringify({ timeBand: { startMinutes: 300, endMinutes: 480 } }),
        createdAt: 1,
      });

      const versions = await listAllowanceDefinitionVersions(db, { tenantId, definitionId: definition.id });
      expect(versions.map((v) => v.name)).toEqual(["早朝手当", "早朝手当(改定)"]);
      expect(versions.map((v) => v.effectiveFrom)).toEqual(["2026-01-01", "2026-04-01"]);
    });
  });

  describe("getAllowanceDefinitionVersionsTimeline", () => {
    it("resolves each definition's series independently (latest before fromDate + within period)", async () => {
      const early = await createAllowanceDefinition(db, {
        tenantId,
        effectiveFrom: "2026-01-01",
        name: "早朝手当",
        conditions: "{}",
        createdAt: 0,
      });
      await insertAllowanceDefinitionVersion(db, {
        tenantId,
        definitionId: early.definition.id,
        effectiveFrom: "2026-04-15",
        name: "早朝手当(改定)",
        conditions: "{}",
        createdAt: 1,
      });
      const nye = await createAllowanceDefinition(db, {
        tenantId,
        effectiveFrom: "2026-03-01", // 期間(4月)より前に開始
        name: "年末年始手当",
        conditions: "{}",
        createdAt: 2,
      });

      const timeline = await getAllowanceDefinitionVersionsTimeline(db, { tenantId, fromDate: "2026-04-01", toDate: "2026-04-30" });
      const byDefinition = new Map<string, string[]>();
      for (const v of timeline) {
        const list = byDefinition.get(v.definitionId) ?? [];
        list.push(v.effectiveFrom);
        byDefinition.set(v.definitionId, list);
      }

      // early: 4/1 時点で最新の版(1/1)+ 期間内の改定(4/15)の両方が含まれる
      expect(byDefinition.get(early.definition.id)).toEqual(["2026-01-01", "2026-04-15"]);
      // nye: 期間より前の唯一の版(3/1)が「fromDate 以前の最新版」として1件だけ含まれる
      expect(byDefinition.get(nye.definition.id)).toEqual(["2026-03-01"]);
    });

    it("excludes a definition whose first version starts after toDate", async () => {
      await createAllowanceDefinition(db, { tenantId, effectiveFrom: "2026-06-01", name: "未来手当", conditions: "{}", createdAt: 0 });

      const timeline = await getAllowanceDefinitionVersionsTimeline(db, { tenantId, fromDate: "2026-04-01", toDate: "2026-04-30" });
      expect(timeline).toEqual([]);
    });

    it("does not duplicate a version whose effective_from equals fromDate exactly", async () => {
      const def = await createAllowanceDefinition(db, {
        tenantId,
        effectiveFrom: "2026-04-01",
        name: "手当",
        conditions: "{}",
        createdAt: 0,
      });

      const timeline = await getAllowanceDefinitionVersionsTimeline(db, { tenantId, fromDate: "2026-04-01", toDate: "2026-04-30" });
      expect(timeline.map((v) => v.definitionId)).toEqual([def.definition.id]);
    });
  });
});
