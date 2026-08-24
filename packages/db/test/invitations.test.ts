import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { isUniqueConstraintError } from "../src/errors.js";
import { migrateDb, type Database } from "./support/db.js";
import { eq } from "drizzle-orm";
import {
  acceptInvitation,
  createInvitation,
  createInvitationInTx,
  createUser,
  findInvitationByTokenHash,
  getLatestInvitationForUser,
  insertAuditLog,
  listInvitationsForTenant,
  listTenantUserIdsWithCredentials,
  revokeInvitation,
  upsertMembership,
  userHasCredential,
} from "../src/queries/index.js";
import { auditLogs, departments, tenants, users } from "../src/schema/index.js";
import { uuidv7 } from "../src/uuid.js";

const DAY_MINUTES = 24 * 60;

describe("invitations", () => {
  let db: Database;
  const tenantId = uuidv7();
  const adminId = uuidv7();

  beforeEach(async () => {
    // このテストは db.transaction() を伴うクエリ(createInvitation / acceptInvitation)を
    // 複数回、その後の通常SELECTと混ぜて呼ぶ。@libsql/client のローカル sqlite3 ドライバは
    // `:memory:` だとトランザクション後にネイティブ接続を手放し、次回アクセス時の遅延再接続が
    // 新規の空DBになってしまう(apps/api/test/support/setup.ts の同種コメント参照)。
    // ファイルバックエンドにしてこれを回避する。
    const dbPath = join(tmpdir(), `kizami-db-test-${randomUUID()}.db`);
    ({ db } = await migrateDb({ url: `file:${dbPath}` }));
    await db.insert(tenants).values({ id: tenantId, name: "Tenant A", createdAt: 0 });
    await db.insert(users).values({ id: adminId, tenantId, email: "admin@example.com", name: "Admin", createdAt: 0 });
  });

  it("createUser then createInvitation issues a token hash, and findInvitationByTokenHash finds it", async () => {
    const target = await createUser(db, { tenantId, email: "new@example.com", name: "New Member", createdAt: 0 });

    const inv = await createInvitation(db, {
      tenantId,
      userId: target.id,
      tokenHash: "hash-1",
      expiresAt: 7 * DAY_MINUTES,
      createdBy: adminId,
      createdAt: 0,
    });
    expect(inv.acceptedAt).toBeNull();
    expect(inv.revokedAt).toBeNull();

    const found = await findInvitationByTokenHash(db, "hash-1");
    expect(found?.id).toBe(inv.id);
    expect(await findInvitationByTokenHash(db, "nonexistent")).toBeNull();
  });

  it("createUser: (tenantId, email) uniqueness violation surfaces via isUniqueConstraintError", async () => {
    await createUser(db, { tenantId, email: "dup@example.com", name: "First", createdAt: 0 });
    await expect(createUser(db, { tenantId, email: "dup@example.com", name: "Second", createdAt: 0 })).rejects.toSatisfy(
      (err: unknown) => isUniqueConstraintError(err),
    );
  });

  it("the same email is allowed across different tenants", async () => {
    const otherTenantId = uuidv7();
    await db.insert(tenants).values({ id: otherTenantId, name: "Tenant B", createdAt: 0 });

    const a = await createUser(db, { tenantId, email: "shared@example.com", name: "A", createdAt: 0 });
    const b = await createUser(db, { tenantId: otherTenantId, email: "shared@example.com", name: "B", createdAt: 0 });
    expect(a.id).not.toBe(b.id);
  });

  it("createInvitation reissue revokes the previous invitation for the same user", async () => {
    const target = await createUser(db, { tenantId, email: "new@example.com", name: "New Member", createdAt: 0 });

    const first = await createInvitation(db, {
      tenantId,
      userId: target.id,
      tokenHash: "hash-first",
      expiresAt: 7 * DAY_MINUTES,
      createdBy: adminId,
      createdAt: 0,
    });
    const second = await createInvitation(db, {
      tenantId,
      userId: target.id,
      tokenHash: "hash-second",
      expiresAt: 8 * DAY_MINUTES,
      createdBy: adminId,
      createdAt: 100,
    });

    const refetchedFirst = await findInvitationByTokenHash(db, "hash-first");
    expect(refetchedFirst?.id).toBe(first.id);
    expect(refetchedFirst?.revokedAt).toBe(100);

    const latest = await getLatestInvitationForUser(db, { tenantId, userId: target.id });
    expect(latest?.id).toBe(second.id);
    expect(latest?.revokedAt).toBeNull();
  });

  it("listInvitationsForTenant returns all invitations for the tenant, newest first", async () => {
    const a = await createUser(db, { tenantId, email: "a@example.com", name: "A", createdAt: 0 });
    const b = await createUser(db, { tenantId, email: "b@example.com", name: "B", createdAt: 0 });
    await createInvitation(db, { tenantId, userId: a.id, tokenHash: "hash-a", expiresAt: DAY_MINUTES, createdBy: adminId, createdAt: 0 });
    await createInvitation(db, { tenantId, userId: b.id, tokenHash: "hash-b", expiresAt: DAY_MINUTES, createdBy: adminId, createdAt: 10 });

    const rows = await listInvitationsForTenant(db, tenantId);
    expect(rows.map((r) => r.userId)).toEqual([b.id, a.id]);
  });

  it("acceptInvitation creates auth_credentials and marks the invitation accepted", async () => {
    const target = await createUser(db, { tenantId, email: "new@example.com", name: "New Member", createdAt: 0 });
    await createInvitation(db, {
      tenantId,
      userId: target.id,
      tokenHash: "hash-accept",
      expiresAt: 7 * DAY_MINUTES,
      createdBy: adminId,
      createdAt: 0,
    });

    expect(await userHasCredential(db, { tenantId, userId: target.id })).toBe(false);

    const result = await acceptInvitation(db, { tokenHash: "hash-accept", passwordHash: "hashed", nowMinutes: 100 });
    expect(result?.userId).toBe(target.id);
    expect(result?.invitation.acceptedAt).toBe(100);

    expect(await userHasCredential(db, { tenantId, userId: target.id })).toBe(true);
    const withCreds = await listTenantUserIdsWithCredentials(db, tenantId);
    expect(withCreds.has(target.id)).toBe(true);
  });

  it("acceptInvitation fails (returns null) for an unknown token", async () => {
    expect(await acceptInvitation(db, { tokenHash: "nonexistent", passwordHash: "hashed", nowMinutes: 0 })).toBeNull();
  });

  it("acceptInvitation fails for an expired invitation", async () => {
    const target = await createUser(db, { tenantId, email: "new@example.com", name: "New Member", createdAt: 0 });
    await createInvitation(db, {
      tenantId,
      userId: target.id,
      tokenHash: "hash-expired",
      expiresAt: 100,
      createdBy: adminId,
      createdAt: 0,
    });

    expect(await acceptInvitation(db, { tokenHash: "hash-expired", passwordHash: "hashed", nowMinutes: 101 })).toBeNull();
  });

  it("acceptInvitation fails for an already-revoked invitation", async () => {
    const target = await createUser(db, { tenantId, email: "new@example.com", name: "New Member", createdAt: 0 });
    const inv = await createInvitation(db, {
      tenantId,
      userId: target.id,
      tokenHash: "hash-revoked",
      expiresAt: 7 * DAY_MINUTES,
      createdBy: adminId,
      createdAt: 0,
    });
    await revokeInvitation(db, { tenantId, id: inv.id, revokedAt: 50 });

    expect(await acceptInvitation(db, { tokenHash: "hash-revoked", passwordHash: "hashed", nowMinutes: 60 })).toBeNull();
  });

  it("acceptInvitation fails for an already-accepted invitation (double accept)", async () => {
    const target = await createUser(db, { tenantId, email: "new@example.com", name: "New Member", createdAt: 0 });
    await createInvitation(db, {
      tenantId,
      userId: target.id,
      tokenHash: "hash-twice",
      expiresAt: 7 * DAY_MINUTES,
      createdBy: adminId,
      createdAt: 0,
    });

    const first = await acceptInvitation(db, { tokenHash: "hash-twice", passwordHash: "hashed-1", nowMinutes: 10 });
    expect(first).not.toBeNull();
    const second = await acceptInvitation(db, { tokenHash: "hash-twice", passwordHash: "hashed-2", nowMinutes: 20 });
    expect(second).toBeNull();
  });

  it("revokeInvitation revokes a pending invitation, and a revoked/accepted one is not revocable again", async () => {
    const target = await createUser(db, { tenantId, email: "new@example.com", name: "New Member", createdAt: 0 });
    const inv = await createInvitation(db, {
      tenantId,
      userId: target.id,
      tokenHash: "hash-rv",
      expiresAt: 7 * DAY_MINUTES,
      createdBy: adminId,
      createdAt: 0,
    });

    const revoked = await revokeInvitation(db, { tenantId, id: inv.id, revokedAt: 50 });
    expect(revoked?.revokedAt).toBe(50);

    // 既に失効済み: 0件更新で null
    expect(await revokeInvitation(db, { tenantId, id: inv.id, revokedAt: 60 })).toBeNull();
  });

  it("revokeInvitation does not revoke an already-accepted invitation", async () => {
    const target = await createUser(db, { tenantId, email: "new@example.com", name: "New Member", createdAt: 0 });
    const inv = await createInvitation(db, {
      tenantId,
      userId: target.id,
      tokenHash: "hash-acc-then-rv",
      expiresAt: 7 * DAY_MINUTES,
      createdBy: adminId,
      createdAt: 0,
    });
    await acceptInvitation(db, { tokenHash: "hash-acc-then-rv", passwordHash: "hashed", nowMinutes: 10 });

    expect(await revokeInvitation(db, { tenantId, id: inv.id, revokedAt: 20 })).toBeNull();
  });

  // レビュー指摘3: 招待受諾のトランザクションに監査ログを同居させた(2026-08-23)。
  it("acceptInvitation writes an invitation.accept audit log in the same transaction", async () => {
    const target = await createUser(db, { tenantId, email: "new@example.com", name: "New Member", createdAt: 0 });
    await createInvitation(db, {
      tenantId,
      userId: target.id,
      tokenHash: "hash-audit",
      expiresAt: 7 * DAY_MINUTES,
      createdBy: adminId,
      createdAt: 0,
    });

    const result = await acceptInvitation(db, { tokenHash: "hash-audit", passwordHash: "hashed", nowMinutes: 42 });
    expect(result?.userId).toBe(target.id);

    const logs = await db.select().from(auditLogs).where(eq(auditLogs.tenantId, tenantId));
    const accepted = logs.filter((l) => l.action === "invitation.accept");
    expect(accepted).toHaveLength(1);
    expect(accepted[0]?.actorId).toBe(target.id);
    expect(accepted[0]?.target).toBe(`user:${target.id}`);
    expect(accepted[0]?.occurredAt).toBe(42);
  });

  // 失敗時に audit_logs も accepted_at も一切残らないこと(1トランザクションで原子的)を確認する。
  it("acceptInvitation writes no audit log when the token is already accepted (fails atomically)", async () => {
    const target = await createUser(db, { tenantId, email: "new@example.com", name: "New Member", createdAt: 0 });
    await createInvitation(db, {
      tenantId,
      userId: target.id,
      tokenHash: "hash-double",
      expiresAt: 7 * DAY_MINUTES,
      createdBy: adminId,
      createdAt: 0,
    });
    await acceptInvitation(db, { tokenHash: "hash-double", passwordHash: "hashed", nowMinutes: 10 });

    const second = await acceptInvitation(db, { tokenHash: "hash-double", passwordHash: "hashed-2", nowMinutes: 20 });
    expect(second).toBeNull();

    const logs = await db.select().from(auditLogs).where(eq(auditLogs.tenantId, tenantId));
    expect(logs.filter((l) => l.action === "invitation.accept")).toHaveLength(1);
  });

  // レビュー指摘2: createUser・upsertMembership・招待発行・監査ログを1トランザクションに
  // まとめられること(apps/api/src/routes/members.ts の POST / と同じ形)を db 層単体で確認する。
  // createInvitationInTx はネストしたトランザクション(SAVEPOINT)を発生させずに、呼び出し側の
  // 外側のトランザクションへそのまま乗る。
  it("createUser + upsertMembership + createInvitationInTx + insertAuditLog compose atomically in one db.transaction", async () => {
    const { insertAuditLog } = await import("../src/queries/audit.js");
    const deptId = uuidv7();
    await db.insert(departments).values({ id: deptId, tenantId, name: "Dept A", createdAt: 0 });

    const created = await db.transaction(async (tx) => {
      const user = await createUser(tx, { tenantId, email: "tx-new@example.com", name: "Tx New Member", createdAt: 0 });
      await upsertMembership(tx, { tenantId, userId: user.id, departmentId: deptId, createdAt: 0 });
      const invitation = await createInvitationInTx(tx, {
        tenantId,
        userId: user.id,
        tokenHash: "hash-tx",
        expiresAt: 7 * DAY_MINUTES,
        createdBy: adminId,
        createdAt: 0,
      });
      await insertAuditLog(tx, {
        tenantId,
        actorId: adminId,
        action: "member.invite",
        targetType: "user",
        targetId: user.id,
        detail: JSON.stringify({ email: user.email }),
        occurredAt: 0,
      });
      return { user, invitation };
    });

    expect(await userHasCredential(db, { tenantId, userId: created.user.id })).toBe(false);
    const found = await findInvitationByTokenHash(db, "hash-tx");
    expect(found?.id).toBe(created.invitation.id);
    const logs = await db.select().from(auditLogs).where(eq(auditLogs.tenantId, tenantId));
    expect(logs.some((l) => l.action === "member.invite" && l.target === `user:${created.user.id}`)).toBe(true);
  });
});

describe("同一分内の再発行(createdAt が同値)の最新解決(2026-08-23 バグ修正)", () => {
  it("同じ nowMinutes で作成→再発行しても、最新として新しい招待が返る", async () => {
    const dbPath = join(tmpdir(), `kizami-db-test-${randomUUID()}.db`);
    const { db } = await migrateDb({ url: `file:${dbPath}` });
    const tenantId = uuidv7();
    const adminId = uuidv7();
    await db.insert(tenants).values({ id: tenantId, name: "Tenant A", createdAt: 0 });
    await db.insert(users).values({ id: adminId, tenantId, email: "admin2@example.com", name: "Admin", createdAt: 0 });
    const target = await createUser(db, { tenantId, email: "same-minute@example.com", name: "Member", createdAt: 0 });

    // createdAt は分単位(nowMinutes)なので、招待作成→即再発行はごく普通の操作で同値になる。
    // タイブレーク(id, uuidv7 の単調性)が無いと「最新の招待」が行順まかせになり、
    // バッジが誤って期限切れ表示になるバグが実際に起きた。
    const first = await createInvitation(db, {
      tenantId, userId: target.id, tokenHash: "hash-first",
      expiresAt: 7 * DAY_MINUTES, createdBy: adminId, createdAt: 100,
    });
    const second = await createInvitation(db, {
      tenantId, userId: target.id, tokenHash: "hash-second",
      expiresAt: 7 * DAY_MINUTES, createdBy: adminId, createdAt: 100, // 同一分
    });

    const latest = await getLatestInvitationForUser(db, { tenantId, userId: target.id });
    expect(latest?.id).toBe(second.id);
    expect(latest?.id).not.toBe(first.id);
    expect(latest?.revokedAt).toBeNull(); // 旧招待は createInvitation が revoke 済み
  });
});
