import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { migrateDb, type Database } from "./support/db.js";
import { eq } from "drizzle-orm";
import {
  createInvitation,
  createPasswordResetToken,
  deactivateMember,
  deactivateUser,
  findPasswordResetTokenByHash,
  getLatestInvitationForUser,
  reactivateUser,
  revokePendingInvitationForUser,
} from "../src/queries/index.js";
import { auditLogs, sessions, tenants, users } from "../src/schema/index.js";
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

// 退職処理の書き込み一式(atomic plan、2026-10-08、docs/design/d1-atomic-writes.md #24)。3レグで走る。
describe("deactivateMember", () => {
  it("deactivates (records deactivated_at), revokes sessions, the pending invitation and reset tokens, and audits — in one unit", async () => {
    const { db, tenantId, adminId, targetId } = await setup();
    await db.insert(sessions).values({ id: "s1", tenantId, userId: targetId, createdAt: 0, expiresAt: DAY_MINUTES, revokedAt: null });
    await createInvitation(db, { tenantId, userId: targetId, tokenHash: "inv", expiresAt: DAY_MINUTES, createdBy: adminId, createdAt: 0 });
    await createPasswordResetToken(db, { tenantId, userId: targetId, tokenHash: "reset", expiresAt: DAY_MINUTES, createdBy: adminId, createdAt: 0 });

    await deactivateMember(db, { tenantId, userId: targetId, actorId: adminId, nowMinutes: 30 });

    const [user] = await db.select().from(users).where(eq(users.id, targetId));
    expect(user?.isActive).toBe(false);
    expect(user?.deactivatedAt).toBe(30);
    expect((await db.select().from(sessions))[0]?.revokedAt).toBe(30);
    expect((await getLatestInvitationForUser(db, { tenantId, userId: targetId }))?.revokedAt).toBe(30);
    expect((await findPasswordResetTokenByHash(db, "reset"))?.revokedAt).toBe(30);
    const logs = await db.select().from(auditLogs).where(eq(auditLogs.action, "member.deactivate"));
    expect(logs).toHaveLength(1);
    expect(logs[0]?.actorId).toBe(adminId);
  });

  it("throws for a nonexistent user and writes nothing (no audit log)", async () => {
    const { db, tenantId, adminId } = await setup();
    await expect(deactivateMember(db, { tenantId, userId: uuidv7(), actorId: adminId, nowMinutes: 30 })).rejects.toThrow("user not found");
    expect(await db.select().from(auditLogs)).toHaveLength(0);
  });
});
