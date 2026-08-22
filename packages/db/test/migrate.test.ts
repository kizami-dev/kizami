import { describe, expect, it } from "vitest";
import { migrateDb } from "../src/migrate.js";
import { tenants } from "../src/schema/index.js";

describe("migrate", () => {
  it("applies the migration and the schema is queryable", async () => {
    const { db, client } = await migrateDb();

    const tableNames = await client.execute("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name != '__drizzle_migrations'");
    const names = tableNames.rows.map((row) => row.name).sort();
    expect(names).toEqual(
      [
        "audit_logs",
        "auth_credentials",
        "closing_events",
        "closing_snapshots",
        "correction_requests",
        "departments",
        "leave_grants",
        "leave_requests",
        "memberships",
        "notifications",
        "permission_presets",
        "preset_assignments",
        "punch_events",
        "sessions",
        "tenant_leave_settings",
        "tenant_notification_settings",
        "tenant_setting_versions",
        "tenants",
        "user_policy_assignments",
        "users",
        "work_policies",
        "work_policy_versions",
      ].sort(),
    );

    const inserted = await db.insert(tenants).values({ id: "t1", name: "Tenant A", createdAt: 0 }).returning();
    expect(inserted[0]?.name).toBe("Tenant A");

    const rows = await db.select().from(tenants);
    // is_small_or_medium_enterprise / is_special_provision_workplace / special_clause_enabled
    // (2026-08-22 追加, 法令パッケージ結線)は既定値(true/false/false)で入る。
    expect(rows).toEqual([
      {
        id: "t1",
        name: "Tenant A",
        isSmallOrMediumEnterprise: true,
        isSpecialProvisionWorkplace: false,
        specialClauseEnabled: false,
        createdAt: 0,
      },
    ]);
  });
});
