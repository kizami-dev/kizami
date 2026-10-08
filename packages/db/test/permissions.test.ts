import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { migrateDb, type Database } from "./support/db.js";
import { listAssignedPresetGrants, listTenantPresetAssignmentRows, replacePresetAssignmentsForUser } from "../src/queries/permissions.js";
import { permissionPresets, presetAssignments, tenants, users } from "../src/schema/index.js";
import { uuidv7 } from "../src/uuid.js";

describe("listAssignedPresetGrants", () => {
  let db: Database;
  const tenantId = uuidv7();
  const userId = uuidv7();

  beforeEach(async () => {
    ({ db } = await migrateDb());
    await db.insert(tenants).values({ id: tenantId, name: "Tenant A", createdAt: 0 });
    await db.insert(users).values({ id: userId, tenantId, email: "a@example.com", name: "A", createdAt: 0 });
  });

  it("returns an empty array when the user has no preset assigned", async () => {
    expect(await listAssignedPresetGrants(db, { tenantId, userId })).toEqual([]);
  });

  it("returns one parsed grants/denies pair per assigned preset", async () => {
    const presetAId = uuidv7();
    const presetBId = uuidv7();
    await db.insert(permissionPresets).values([
      {
        id: presetAId,
        tenantId,
        name: "A",
        grants: JSON.stringify([{ key: "member.view", scope: "tenant" }]),
        isSystem: true,
        createdAt: 0,
      },
      {
        id: presetBId,
        tenantId,
        name: "B",
        grants: JSON.stringify([{ key: "audit_log.view", scope: "department" }]),
        isSystem: true,
        createdAt: 0,
      },
    ]);
    await db.insert(presetAssignments).values([
      { id: uuidv7(), tenantId, userId, presetId: presetAId, createdAt: 0 },
      { id: uuidv7(), tenantId, userId, presetId: presetBId, createdAt: 0 },
    ]);

    const presets = await listAssignedPresetGrants(db, { tenantId, userId });
    expect(presets).toHaveLength(2);
    // denies 列は既定 "[]"(拒否なし)なので、明示していないプリセットは常に空配列で返る
    expect(presets).toContainEqual({ grants: [{ key: "member.view", scope: "tenant" }], denies: [] });
    expect(presets).toContainEqual({ grants: [{ key: "audit_log.view", scope: "department" }], denies: [] });
  });

  it("parses the denies column alongside grants (2026-08-24 拒否ルール)", async () => {
    const presetId = uuidv7();
    await db.insert(permissionPresets).values({
      id: presetId,
      tenantId,
      name: "拒否入り",
      grants: JSON.stringify([{ key: "member.view", scope: "tenant" }]),
      denies: JSON.stringify(["closing.execute", "audit_log.view"]),
      isSystem: false,
      createdAt: 0,
    });
    await db.insert(presetAssignments).values({ id: uuidv7(), tenantId, userId, presetId, createdAt: 0 });

    expect(await listAssignedPresetGrants(db, { tenantId, userId })).toEqual([
      { grants: [{ key: "member.view", scope: "tenant" }], denies: ["closing.execute", "audit_log.view"] },
    ]);
  });

  it("does not return another user's assigned presets", async () => {
    const otherUserId = uuidv7();
    await db.insert(users).values({ id: otherUserId, tenantId, email: "b@example.com", name: "B", createdAt: 0 });
    const presetId = uuidv7();
    await db.insert(permissionPresets).values({
      id: presetId,
      tenantId,
      name: "A",
      grants: JSON.stringify([{ key: "member.view", scope: "tenant" }]),
      isSystem: true,
      createdAt: 0,
    });
    await db.insert(presetAssignments).values({ id: uuidv7(), tenantId, userId: otherUserId, presetId, createdAt: 0 });

    expect(await listAssignedPresetGrants(db, { tenantId, userId })).toEqual([]);
  });

  /**
   * listTenantPresetAssignmentRows は presetId を保持する点だけが
   * listTenantPresetGrantsByUser と違う(プリセット編集時の「最後の権限管理保持者」判定で、
   * 編集対象のプリセットだけを編集後の内容へ差し替えるために必要 — 2026-08-24)。
   */
  it("listTenantPresetAssignmentRows keeps the presetId of each assignment", async () => {
    const presetId = uuidv7();
    await db.insert(permissionPresets).values({
      id: presetId,
      tenantId,
      name: "A",
      grants: JSON.stringify([{ key: "permission.preset.manage", scope: "tenant" }]),
      denies: JSON.stringify(["closing.execute"]),
      isSystem: false,
      createdAt: 0,
    });
    await db.insert(presetAssignments).values({ id: uuidv7(), tenantId, userId, presetId, createdAt: 0 });

    expect(await listTenantPresetAssignmentRows(db, tenantId)).toEqual([
      {
        userId,
        presetId,
        grants: JSON.stringify([{ key: "permission.preset.manage", scope: "tenant" }]),
        denies: JSON.stringify(["closing.execute"]),
      },
    ]);
  });
});

// 割当の置き換え(atomic plan、2026-10-08、docs/design/d1-atomic-writes.md #7)。3レグで走る。
describe("replacePresetAssignmentsForUser", () => {
  let db: Database;
  const tenantId = uuidv7();
  const userId = uuidv7();

  beforeEach(async () => {
    const dbPath = join(tmpdir(), `kizami-db-test-${randomUUID()}.db`);
    ({ db } = await migrateDb({ url: `file:${dbPath}` }));
    await db.insert(tenants).values({ id: tenantId, name: "Tenant A", createdAt: 0 });
    await db.insert(users).values({ id: userId, tenantId, email: "a@example.com", name: "A", createdAt: 0 });
  });

  async function presets(n: number): Promise<string[]> {
    const ids = Array.from({ length: n }, () => uuidv7());
    for (const id of ids) {
      await db.insert(permissionPresets).values({ id, tenantId, name: `P-${id}`, grants: "[]", createdAt: 0 });
    }
    return ids;
  }
  const assigned = async () =>
    (await db.select().from(presetAssignments).where(eq(presetAssignments.userId, userId))).map((r) => r.presetId).sort();

  it("replaces the whole set, and an empty set clears it", async () => {
    const [a, b, c] = await presets(3);
    await replacePresetAssignmentsForUser(db, { tenantId, userId, presetIds: [a!, b!], createdAt: 1 });
    expect(await assigned()).toEqual([a, b].sort());
    await replacePresetAssignmentsForUser(db, { tenantId, userId, presetIds: [c!], createdAt: 2 });
    expect(await assigned()).toEqual([c]);
    await replacePresetAssignmentsForUser(db, { tenantId, userId, presetIds: [], createdAt: 3 });
    expect(await assigned()).toEqual([]);
  });

  it("splits a large set into inserts under D1's 100-bound-parameter limit (5 columns × 45 rows)", async () => {
    const ids = await presets(45);
    await replacePresetAssignmentsForUser(db, { tenantId, userId, presetIds: ids, createdAt: 1 });
    expect(await assigned()).toEqual([...ids].sort());
  });

  it("an invalid preset id rolls the whole replacement back (the old assignments survive)", async () => {
    const [a] = await presets(1);
    await replacePresetAssignmentsForUser(db, { tenantId, userId, presetIds: [a!], createdAt: 1 });
    await expect(replacePresetAssignmentsForUser(db, { tenantId, userId, presetIds: [uuidv7()], createdAt: 2 })).rejects.toThrow();
    expect(await assigned()).toEqual([a]);
  });
});
