import { beforeEach, describe, expect, it } from "vitest";
import { migrateDb, type Database } from "./support/db.js";
import { deleteHelpOverride, getHelpOverride, getHelpOverrides, upsertHelpOverride } from "../src/queries/help-overrides.js";
import { helpOverrides, tenants, users } from "../src/schema/index.js";
import { uuidv7 } from "../src/uuid.js";

describe("help_overrides queries", () => {
  let db: Database;
  const tenantId = uuidv7();
  const otherTenantId = uuidv7();
  const userId = uuidv7();

  beforeEach(async () => {
    ({ db } = await migrateDb());
    await db.insert(tenants).values([
      { id: tenantId, name: "Tenant A", createdAt: 0 },
      { id: otherTenantId, name: "Tenant B", createdAt: 0 },
    ]);
    await db.insert(users).values({ id: userId, tenantId, email: "admin@example.com", name: "Admin", createdAt: 0 });
  });

  it("getHelpOverrides returns an empty record when nothing is configured", async () => {
    expect(await getHelpOverrides(db, tenantId)).toEqual({});
  });

  it("upsertHelpOverride creates a new row, keyed by (tenantId, helpKey)", async () => {
    const created = await upsertHelpOverride(db, {
      tenantId,
      helpKey: "leave.mandatory-five-days",
      bodyMd: "申請は取得日の前日までにお願いします。",
      updatedBy: userId,
      updatedAt: 100,
    });

    expect(created.tenantId).toBe(tenantId);
    expect(created.helpKey).toBe("leave.mandatory-five-days");
    expect(created.bodyMd).toBe("申請は取得日の前日までにお願いします。");

    const all = await getHelpOverrides(db, tenantId);
    expect(Object.keys(all)).toEqual(["leave.mandatory-five-days"]);
    expect(all["leave.mandatory-five-days"]?.bodyMd).toBe("申請は取得日の前日までにお願いします。");
  });

  it("upsertHelpOverride replaces the existing row for the same (tenantId, helpKey) instead of inserting a second row", async () => {
    await upsertHelpOverride(db, {
      tenantId,
      helpKey: "leave.mandatory-five-days",
      bodyMd: "旧文言",
      updatedBy: userId,
      updatedAt: 100,
    });
    const updated = await upsertHelpOverride(db, {
      tenantId,
      helpKey: "leave.mandatory-five-days",
      bodyMd: "新文言",
      updatedBy: userId,
      updatedAt: 200,
    });

    expect(updated.bodyMd).toBe("新文言");
    expect(updated.updatedAt).toBe(200);

    const rows = await db.select().from(helpOverrides);
    expect(rows).toHaveLength(1);
  });

  it("keeps rows for different tenants independent even with the same helpKey", async () => {
    await upsertHelpOverride(db, {
      tenantId,
      helpKey: "leave.mandatory-five-days",
      bodyMd: "Aの規定",
      updatedBy: userId,
      updatedAt: 100,
    });
    await upsertHelpOverride(db, {
      tenantId: otherTenantId,
      helpKey: "leave.mandatory-five-days",
      bodyMd: "Bの規定",
      updatedBy: userId,
      updatedAt: 100,
    });

    expect((await getHelpOverride(db, tenantId, "leave.mandatory-five-days"))?.bodyMd).toBe("Aの規定");
    expect((await getHelpOverride(db, otherTenantId, "leave.mandatory-five-days"))?.bodyMd).toBe("Bの規定");
  });

  it("getHelpOverride returns null when unset", async () => {
    expect(await getHelpOverride(db, tenantId, "leave.mandatory-five-days")).toBeNull();
  });

  it("deleteHelpOverride removes the row and is a no-op when nothing exists", async () => {
    await upsertHelpOverride(db, {
      tenantId,
      helpKey: "leave.mandatory-five-days",
      bodyMd: "本文",
      updatedBy: userId,
      updatedAt: 100,
    });
    await deleteHelpOverride(db, tenantId, "leave.mandatory-five-days");
    expect(await getHelpOverride(db, tenantId, "leave.mandatory-five-days")).toBeNull();

    // 既に無い状態での削除はエラーにしない
    await expect(deleteHelpOverride(db, tenantId, "leave.mandatory-five-days")).resolves.toBeUndefined();
  });
});
