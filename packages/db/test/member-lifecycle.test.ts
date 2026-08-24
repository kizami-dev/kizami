import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { migrateDb, type Database } from "./support/db.js";
import { createInvitation, deactivateUser, reactivateUser, revokePendingInvitationForUser } from "../src/queries/index.js";
import { tenants, users } from "../src/schema/index.js";
import { uuidv7 } from "../src/uuid.js";

const DAY_MINUTES = 24 * 60;

async function setup(): Promise<{ db: Database; tenantId: string; adminId: string; targetId: string }> {
  const dbPath = join(tmpdir(), `kizami-db-test-${randomUUID()}.db`);
  const { db } = await migrateDb({ url: `file:${dbPath}` });
  const tenantId = uuidv7();
  const adminId = uuidv7();
  const targetId = uuidv7();
  await db.insert(tenants).values({ id: tenantId, name: "Tenant A", createdAt: 0 });
  await db.insert(users).values([
    { id: adminId, tenantId, email: "admin@example.com", name: "Admin", isActive: true, createdAt: 0 },
    { id: targetId, tenantId, email: "target@example.com", name: "Target", isActive: true, createdAt: 0 },
  ]);
  return { db, tenantId, adminId, targetId };
}

describe("deactivateUser / reactivateUser", () => {
  it("deactivateUser sets isActive=false, reactivateUser sets it back to true", async () => {
    const { db, tenantId, targetId } = await setup();

    const deactivated = await deactivateUser(db, { tenantId, userId: targetId });
    expect(deactivated.isActive).toBe(false);

    const reactivated = await reactivateUser(db, { tenantId, userId: targetId });
    expect(reactivated.isActive).toBe(true);
  });

  it("deactivateUser throws for a nonexistent user", async () => {
    const { db, tenantId } = await setup();
    await expect(deactivateUser(db, { tenantId, userId: uuidv7() })).rejects.toThrow();
  });
});

describe("revokePendingInvitationForUser", () => {
  it("revokes the pending invitation for the user", async () => {
    const { db, tenantId, adminId, targetId } = await setup();
    await createInvitation(db, {
      tenantId,
      userId: targetId,
      tokenHash: "hash-pending",
      expiresAt: DAY_MINUTES,
      createdBy: adminId,
      createdAt: 0,
    });

    await revokePendingInvitationForUser(db, { tenantId, userId: targetId, revokedAt: 30 });

    const { findInvitationByTokenHash } = await import("../src/queries/invitations.js");
    const found = await findInvitationByTokenHash(db, "hash-pending");
    expect(found?.revokedAt).toBe(30);
  });

  it("is idempotent (no-op) when there is no pending invitation", async () => {
    const { db, tenantId, targetId } = await setup();
    await expect(revokePendingInvitationForUser(db, { tenantId, userId: targetId, revokedAt: 30 })).resolves.toBeUndefined();
  });
});
