import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { migrateDb, supportsTransactions, type Database } from "./support/db.js";
import {
  createPasswordResetToken,
  findPasswordResetTokenByHash,
  getLatestPasswordResetTokenForUser,
  listPasswordResetTokensForTenant,
  revokeAllPasswordResetTokensForUser,
  revokeAllSessionsForUser,
  revokePasswordResetToken,
  usePasswordResetToken,
} from "../src/queries/index.js";
import { authCredentials, auditLogs, sessions, tenants, users } from "../src/schema/index.js";
import { uuidv7 } from "../src/uuid.js";

const DAY_MINUTES = 24 * 60;

// D1 は明示トランザクション(BEGIN/COMMIT)を拒否するため、db.transaction() を通る
// テストは D1 レグでは skip する(support/db.ts の supportsTransactions と
// docs/design/workers-d1.md「D1 で動かないもの」を参照)
describe.skipIf(!supportsTransactions)("password-resets", () => {
  let db: Database;
  const tenantId = uuidv7();
  const adminId = uuidv7();
  let targetId: string;

  beforeEach(async () => {
    // db.transaction() を伴うクエリ(createPasswordResetToken / usePasswordResetToken)を
    // 複数回、通常SELECTと混ぜて呼ぶため、invitations.test.ts と同じ理由でファイルバックエンドにする。
    const dbPath = join(tmpdir(), `kizami-db-test-${randomUUID()}.db`);
    ({ db } = await migrateDb({ url: `file:${dbPath}` }));
    await db.insert(tenants).values({ id: tenantId, name: "Tenant A", createdAt: 0 });
    await db.insert(users).values({ id: adminId, tenantId, email: "admin@example.com", name: "Admin", createdAt: 0 });

    // パスワードリセットの対象は「受諾済み(auth_credentials あり)」のユーザーが前提。
    targetId = uuidv7();
    await db.insert(users).values({ id: targetId, tenantId, email: "target@example.com", name: "Target", createdAt: 0 });
    await db.insert(authCredentials).values({
      id: uuidv7(),
      tenantId,
      userId: targetId,
      passwordHash: "old-hash",
      createdAt: 0,
      updatedAt: 0,
    });
  });

  it("createPasswordResetToken issues a token hash, and findPasswordResetTokenByHash finds it", async () => {
    const token = await createPasswordResetToken(db, {
      tenantId,
      userId: targetId,
      tokenHash: "hash-1",
      expiresAt: DAY_MINUTES,
      createdBy: adminId,
      createdAt: 0,
    });
    expect(token.usedAt).toBeNull();
    expect(token.revokedAt).toBeNull();

    const found = await findPasswordResetTokenByHash(db, "hash-1");
    expect(found?.id).toBe(token.id);
    expect(await findPasswordResetTokenByHash(db, "nonexistent")).toBeNull();
  });

  it("createPasswordResetToken reissue revokes the previous token for the same user", async () => {
    const first = await createPasswordResetToken(db, {
      tenantId,
      userId: targetId,
      tokenHash: "hash-first",
      expiresAt: DAY_MINUTES,
      createdBy: adminId,
      createdAt: 0,
    });
    const second = await createPasswordResetToken(db, {
      tenantId,
      userId: targetId,
      tokenHash: "hash-second",
      expiresAt: DAY_MINUTES,
      createdBy: adminId,
      createdAt: 100,
    });

    const refetchedFirst = await findPasswordResetTokenByHash(db, "hash-first");
    expect(refetchedFirst?.id).toBe(first.id);
    expect(refetchedFirst?.revokedAt).toBe(100);

    const latest = await getLatestPasswordResetTokenForUser(db, { tenantId, userId: targetId });
    expect(latest?.id).toBe(second.id);
    expect(latest?.revokedAt).toBeNull();
  });

  it("listPasswordResetTokensForTenant returns all tokens for the tenant, newest first", async () => {
    const secondUserId = uuidv7();
    await db.insert(users).values({ id: secondUserId, tenantId, email: "second@example.com", name: "Second", createdAt: 0 });

    await createPasswordResetToken(db, { tenantId, userId: targetId, tokenHash: "hash-a", expiresAt: DAY_MINUTES, createdBy: adminId, createdAt: 0 });
    await createPasswordResetToken(db, { tenantId, userId: secondUserId, tokenHash: "hash-b", expiresAt: DAY_MINUTES, createdBy: adminId, createdAt: 10 });

    const rows = await listPasswordResetTokensForTenant(db, tenantId);
    expect(rows.map((r) => r.userId)).toEqual([secondUserId, targetId]);
  });

  it("usePasswordResetToken updates auth_credentials, revokes sessions, and marks the token used", async () => {
    await createPasswordResetToken(db, {
      tenantId,
      userId: targetId,
      tokenHash: "hash-use",
      expiresAt: DAY_MINUTES,
      createdBy: adminId,
      createdAt: 0,
    });

    // 使用前に張っていたセッションが失効することを確認するため1本作っておく。
    await db.insert(sessions).values({ id: "session-1", tenantId, userId: targetId, createdAt: 0, expiresAt: DAY_MINUTES, revokedAt: null });

    const result = await usePasswordResetToken(db, { tokenHash: "hash-use", passwordHash: "new-hash", nowMinutes: 50 });
    expect(result?.userId).toBe(targetId);
    expect(result?.passwordResetToken.usedAt).toBe(50);

    const cred = (await db.select().from(authCredentials).where(eq(authCredentials.userId, targetId)).limit(1))[0];
    expect(cred?.passwordHash).toBe("new-hash");
    expect(cred?.updatedAt).toBe(50);

    const session = (await db.select().from(sessions).where(eq(sessions.id, "session-1")).limit(1))[0];
    expect(session?.revokedAt).toBe(50);
  });

  it("usePasswordResetToken fails (returns null) for an unknown token", async () => {
    expect(await usePasswordResetToken(db, { tokenHash: "nonexistent", passwordHash: "x", nowMinutes: 0 })).toBeNull();
  });

  it("usePasswordResetToken fails for an expired token", async () => {
    await createPasswordResetToken(db, {
      tenantId,
      userId: targetId,
      tokenHash: "hash-expired",
      expiresAt: 100,
      createdBy: adminId,
      createdAt: 0,
    });

    expect(await usePasswordResetToken(db, { tokenHash: "hash-expired", passwordHash: "x", nowMinutes: 101 })).toBeNull();
  });

  it("usePasswordResetToken fails for an already-revoked token", async () => {
    const token = await createPasswordResetToken(db, {
      tenantId,
      userId: targetId,
      tokenHash: "hash-revoked",
      expiresAt: DAY_MINUTES,
      createdBy: adminId,
      createdAt: 0,
    });
    await revokePasswordResetToken(db, { tenantId, id: token.id, revokedAt: 50 });

    expect(await usePasswordResetToken(db, { tokenHash: "hash-revoked", passwordHash: "x", nowMinutes: 60 })).toBeNull();
  });

  it("usePasswordResetToken fails for an already-used token (double use)", async () => {
    await createPasswordResetToken(db, {
      tenantId,
      userId: targetId,
      tokenHash: "hash-twice",
      expiresAt: DAY_MINUTES,
      createdBy: adminId,
      createdAt: 0,
    });

    const first = await usePasswordResetToken(db, { tokenHash: "hash-twice", passwordHash: "x1", nowMinutes: 10 });
    expect(first).not.toBeNull();
    const second = await usePasswordResetToken(db, { tokenHash: "hash-twice", passwordHash: "x2", nowMinutes: 20 });
    expect(second).toBeNull();
  });

  it("usePasswordResetToken writes a password_reset.use audit log", async () => {
    await createPasswordResetToken(db, {
      tenantId,
      userId: targetId,
      tokenHash: "hash-audit",
      expiresAt: DAY_MINUTES,
      createdBy: adminId,
      createdAt: 0,
    });

    const result = await usePasswordResetToken(db, { tokenHash: "hash-audit", passwordHash: "x", nowMinutes: 42 });
    expect(result?.userId).toBe(targetId);

    const logs = await db.select().from(auditLogs).where(eq(auditLogs.tenantId, tenantId));
    const used = logs.filter((l) => l.action === "password_reset.use");
    expect(used).toHaveLength(1);
    expect(used[0]?.actorId).toBe(targetId);
    expect(used[0]?.target).toBe(`user:${targetId}`);
    expect(used[0]?.occurredAt).toBe(42);
  });

  it("revokePasswordResetToken revokes a pending token, and a revoked/used one is not revocable again", async () => {
    const token = await createPasswordResetToken(db, {
      tenantId,
      userId: targetId,
      tokenHash: "hash-rv",
      expiresAt: DAY_MINUTES,
      createdBy: adminId,
      createdAt: 0,
    });

    const revoked = await revokePasswordResetToken(db, { tenantId, id: token.id, revokedAt: 50 });
    expect(revoked?.revokedAt).toBe(50);

    expect(await revokePasswordResetToken(db, { tenantId, id: token.id, revokedAt: 60 })).toBeNull();
  });

  it("revokePasswordResetToken does not revoke an already-used token", async () => {
    await createPasswordResetToken(db, {
      tenantId,
      userId: targetId,
      tokenHash: "hash-used-then-rv",
      expiresAt: DAY_MINUTES,
      createdBy: adminId,
      createdAt: 0,
    });
    const used = await usePasswordResetToken(db, { tokenHash: "hash-used-then-rv", passwordHash: "x", nowMinutes: 10 });

    expect(await revokePasswordResetToken(db, { tenantId, id: used?.passwordResetToken.id as string, revokedAt: 20 })).toBeNull();
  });

  it("revokeAllPasswordResetTokensForUser revokes the pending token idempotently (0 rows if none)", async () => {
    // 未決着トークンが無くてもエラーにならない。
    await revokeAllPasswordResetTokensForUser(db, { tenantId, userId: targetId, revokedAt: 10 });

    const token = await createPasswordResetToken(db, {
      tenantId,
      userId: targetId,
      tokenHash: "hash-bulk",
      expiresAt: DAY_MINUTES,
      createdBy: adminId,
      createdAt: 0,
    });
    await revokeAllPasswordResetTokensForUser(db, { tenantId, userId: targetId, revokedAt: 20 });

    const refetched = await findPasswordResetTokenByHash(db, "hash-bulk");
    expect(refetched?.id).toBe(token.id);
    expect(refetched?.revokedAt).toBe(20);
  });
});

describe("revokeAllSessionsForUser", () => {
  it("revokes only the target user's active sessions, leaving others untouched", async () => {
    const dbPath = join(tmpdir(), `kizami-db-test-${randomUUID()}.db`);
    const { db } = await migrateDb({ url: `file:${dbPath}` });
    const tenantId = uuidv7();
    const userA = uuidv7();
    const userB = uuidv7();
    await db.insert(tenants).values({ id: tenantId, name: "Tenant A", createdAt: 0 });
    await db.insert(users).values([
      { id: userA, tenantId, email: "a@example.com", name: "A", createdAt: 0 },
      { id: userB, tenantId, email: "b@example.com", name: "B", createdAt: 0 },
    ]);
    await db.insert(sessions).values([
      { id: "session-a1", tenantId, userId: userA, createdAt: 0, expiresAt: DAY_MINUTES, revokedAt: null },
      { id: "session-a2", tenantId, userId: userA, createdAt: 0, expiresAt: DAY_MINUTES, revokedAt: null },
      { id: "session-b1", tenantId, userId: userB, createdAt: 0, expiresAt: DAY_MINUTES, revokedAt: null },
    ]);

    await revokeAllSessionsForUser(db, { tenantId, userId: userA, revokedAt: 30 });

    const rows = await db.select().from(sessions);
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get("session-a1")?.revokedAt).toBe(30);
    expect(byId.get("session-a2")?.revokedAt).toBe(30);
    expect(byId.get("session-b1")?.revokedAt).toBeNull();
  });
});
