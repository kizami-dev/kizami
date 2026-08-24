import { beforeEach, describe, expect, it } from "vitest";
import { migrateDb, type Database } from "./support/db.js";
import { listAssignedPresetGrants } from "../src/queries/permissions.js";
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

  it("returns one parsed grants array per assigned preset", async () => {
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

    const grants = await listAssignedPresetGrants(db, { tenantId, userId });
    expect(grants).toHaveLength(2);
    expect(grants).toContainEqual([{ key: "member.view", scope: "tenant" }]);
    expect(grants).toContainEqual([{ key: "audit_log.view", scope: "department" }]);
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
});
