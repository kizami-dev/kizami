import { beforeEach, describe, expect, it } from "vitest";
import { migrateDb, type Database } from "../src/migrate.js";
import { getTenantById, updateTenantWorkRulesUrl } from "../src/queries/tenants.js";
import { tenants } from "../src/schema/index.js";
import { uuidv7 } from "../src/uuid.js";

describe("tenants queries — work_rules_url", () => {
  let db: Database;
  const tenantId = uuidv7();

  beforeEach(async () => {
    ({ db } = await migrateDb());
    await db.insert(tenants).values({ id: tenantId, name: "Tenant A", createdAt: 0 });
  });

  it("defaults to null when never set", async () => {
    const tenant = await getTenantById(db, tenantId);
    expect(tenant?.workRulesUrl).toBeNull();
  });

  it("updateTenantWorkRulesUrl sets the URL", async () => {
    const updated = await updateTenantWorkRulesUrl(db, { tenantId, workRulesUrl: "https://example.com/rules.pdf" });
    expect(updated.workRulesUrl).toBe("https://example.com/rules.pdf");

    const fetched = await getTenantById(db, tenantId);
    expect(fetched?.workRulesUrl).toBe("https://example.com/rules.pdf");
  });

  it("updateTenantWorkRulesUrl(null) clears the URL", async () => {
    await updateTenantWorkRulesUrl(db, { tenantId, workRulesUrl: "https://example.com/rules.pdf" });
    const cleared = await updateTenantWorkRulesUrl(db, { tenantId, workRulesUrl: null });
    expect(cleared.workRulesUrl).toBeNull();
  });

  it("throws when the tenant does not exist", async () => {
    await expect(updateTenantWorkRulesUrl(db, { tenantId: uuidv7(), workRulesUrl: "https://example.com" })).rejects.toThrow();
  });
});
