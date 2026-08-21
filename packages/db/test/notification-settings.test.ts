import { beforeEach, describe, expect, it } from "vitest";
import { migrateDb, type Database } from "../src/migrate.js";
import { getNotificationSettings, upsertNotificationSettings } from "../src/queries/notification-settings.js";
import { tenantNotificationSettings, tenants, users } from "../src/schema/index.js";
import { uuidv7 } from "../src/uuid.js";

describe("notification settings queries", () => {
  let db: Database;
  const tenantId = uuidv7();
  const userId = uuidv7();

  beforeEach(async () => {
    ({ db } = await migrateDb());
    await db.insert(tenants).values({ id: tenantId, name: "Tenant A", createdAt: 0 });
    await db.insert(users).values({ id: userId, tenantId, email: "admin@example.com", name: "Admin", createdAt: 0 });
  });

  it("getNotificationSettings returns null when nothing has been configured yet", async () => {
    expect(await getNotificationSettings(db, tenantId)).toBeNull();
  });

  it("upsertNotificationSettings creates a new row", async () => {
    const created = await upsertNotificationSettings(db, {
      tenantId,
      webhookEnabled: true,
      webhookUrl: "https://hooks.slack.com/services/xxx",
      smtpEnabled: false,
      smtpHost: null,
      smtpPort: null,
      smtpUser: null,
      smtpPassword: null,
      smtpFrom: null,
      updatedAt: 100,
      updatedBy: userId,
    });

    expect(created.tenantId).toBe(tenantId);
    expect(created.webhookEnabled).toBe(true);
    expect(created.webhookUrl).toBe("https://hooks.slack.com/services/xxx");
    expect(created.smtpEnabled).toBe(false);

    const fetched = await getNotificationSettings(db, tenantId);
    expect(fetched).toEqual(created);
  });

  it("upsertNotificationSettings replaces the existing row on a second call for the same tenant", async () => {
    await upsertNotificationSettings(db, {
      tenantId,
      webhookEnabled: true,
      webhookUrl: "https://hooks.slack.com/services/xxx",
      smtpEnabled: false,
      smtpHost: null,
      smtpPort: null,
      smtpUser: null,
      smtpPassword: null,
      smtpFrom: null,
      updatedAt: 100,
      updatedBy: userId,
    });

    const updated = await upsertNotificationSettings(db, {
      tenantId,
      webhookEnabled: false,
      webhookUrl: null,
      smtpEnabled: true,
      smtpHost: "smtp.example.com",
      smtpPort: 587,
      smtpUser: "user@example.com",
      smtpPassword: "secret",
      smtpFrom: "kizami@example.com",
      updatedAt: 200,
      updatedBy: userId,
    });

    expect(updated.webhookEnabled).toBe(false);
    expect(updated.webhookUrl).toBeNull();
    expect(updated.smtpEnabled).toBe(true);
    expect(updated.smtpHost).toBe("smtp.example.com");
    expect(updated.smtpPassword).toBe("secret");
    expect(updated.updatedAt).toBe(200);

    const fetched = await getNotificationSettings(db, tenantId);
    expect(fetched?.smtpHost).toBe("smtp.example.com");

    // 依然として1テナント1行のみ(insertではなくupdateされている)
    const all = await db.select().from(tenantNotificationSettings);
    expect(all).toHaveLength(1);
  });

  it("clearing smtpPassword by passing null persists null (not the previous value)", async () => {
    await upsertNotificationSettings(db, {
      tenantId,
      webhookEnabled: false,
      webhookUrl: null,
      smtpEnabled: true,
      smtpHost: "smtp.example.com",
      smtpPort: 587,
      smtpUser: "user@example.com",
      smtpPassword: "secret",
      smtpFrom: "kizami@example.com",
      updatedAt: 100,
      updatedBy: userId,
    });

    const cleared = await upsertNotificationSettings(db, {
      tenantId,
      webhookEnabled: false,
      webhookUrl: null,
      smtpEnabled: true,
      smtpHost: "smtp.example.com",
      smtpPort: 587,
      smtpUser: "user@example.com",
      smtpPassword: null,
      smtpFrom: "kizami@example.com",
      updatedAt: 200,
      updatedBy: userId,
    });

    expect(cleared.smtpPassword).toBeNull();
  });
});
