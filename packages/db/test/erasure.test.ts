/**
 * 退職者の個人データ消去(atomic plan、2026-10-08、docs/design/d1-atomic-writes.md #26)。
 * apps/api の POST /members/:id/erase が使う `eraseUserPersonalDataAtomically` を3レグで確かめる。
 * (消す・残すの線引きそのものは apps/api/test の members-erase 系が API 越しに見ている)
 */
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { migrateDb, type Database } from "./support/db.js";
import {
  countUserPersonalData,
  ERASED_USER_NAME,
  eraseUserPersonalDataAtomically,
  insertSlackLinkToken,
  linkSlackUser,
  tombstoneEmail,
  upsertPendingUserTotp,
  type EraseUserResult,
} from "../src/queries/index.js";
import {
  auditLogs,
  authCredentials,
  notifications,
  sessions,
  slackLinkTokens,
  slackUserLinks,
  tenants,
  userTotpRecoveryCodes,
  users,
} from "../src/schema/index.js";
import { uuidv7 } from "../src/uuid.js";

describe("eraseUserPersonalDataAtomically", () => {
  let db: Database;
  const tenantId = uuidv7();
  const adminId = uuidv7();
  const targetId = uuidv7();
  const otherId = uuidv7();

  beforeEach(async () => {
    const dbPath = join(tmpdir(), `kizami-db-test-${randomUUID()}.db`);
    ({ db } = await migrateDb({ url: `file:${dbPath}` }));
    await db.insert(tenants).values({ id: tenantId, name: "Tenant A", createdAt: 0 });
    await db.insert(users).values([
      { id: adminId, tenantId, email: "admin@example.com", name: "Admin", createdAt: 0 },
      { id: targetId, tenantId, email: "target@example.com", name: "退職者", isActive: false, deactivatedAt: 0, createdAt: 0 },
      { id: otherId, tenantId, email: "other@example.com", name: "Other", createdAt: 0 },
    ]);

    // 対象者の個人データ
    for (const userId of [targetId, otherId]) {
      await db.insert(authCredentials).values({ id: uuidv7(), tenantId, userId, passwordHash: "h", createdAt: 0, updatedAt: 0 });
      await db.insert(sessions).values({ id: `s-${userId}`, tenantId, userId, createdAt: 0, expiresAt: 1000, revokedAt: null });
      await upsertPendingUserTotp(db, { tenantId, userId, secretEncrypted: "enc:v1:x", createdAt: 0 });
      await db.insert(userTotpRecoveryCodes).values(
        [0, 1].map((i) => ({ id: uuidv7(), tenantId, userId, codeHash: `${userId}-${i}`, consumedAt: null, createdAt: 0 })),
      );
      await db.insert(notifications).values({ id: uuidv7(), tenantId, userId, type: "t", subjectDate: null, title: "t", body: "b", createdAt: 0 });
    }
    // Slack: 対象者の連携と、その slack_user_id の未使用トークン2本。他人の連携・トークンは残る
    await linkSlackUser(db, { tenantId, slackUserId: "U-TARGET", userId: targetId, linkedAt: 0 });
    await linkSlackUser(db, { tenantId, slackUserId: "U-OTHER", userId: otherId, linkedAt: 0 });
    await insertSlackLinkToken(db, { tenantId, slackUserId: "U-TARGET", tokenHash: "t1", expiresAt: 1000, createdAt: 0 });
    await insertSlackLinkToken(db, { tenantId, slackUserId: "U-TARGET", tokenHash: "t2", expiresAt: 1000, createdAt: 0 });
    await insertSlackLinkToken(db, { tenantId, slackUserId: "U-OTHER", tokenHash: "t3", expiresAt: 1000, createdAt: 0 });
  });

  const erase = (erasedAt: number) =>
    eraseUserPersonalDataAtomically(db, {
      tenantId,
      userId: targetId,
      erasedAt,
      audit: (removed) => ({
        tenantId,
        actorId: adminId,
        action: "member.erase",
        targetType: "user",
        targetId,
        detail: JSON.stringify({ removed }),
        occurredAt: erasedAt,
      }),
    });

  const expectedRemoved: EraseUserResult["removed"] = {
    authCredentials: 1,
    sessions: 1,
    totp: 1,
    totpRecoveryCodes: 2,
    pushSubscriptions: 0,
    userNotificationSettings: 0,
    apiKeys: 0,
    invitations: 0,
    passwordResetTokens: 0,
    slackUserLinks: 1,
    slackLinkTokens: 2,
    notifications: 1,
    punchEventMeta: 0,
  };

  it("anonymizes the user, deletes the personal data (Slack tokens via the link), and audits the pre-counted removals", async () => {
    expect(await countUserPersonalData(db, { tenantId, userId: targetId })).toEqual(expectedRemoved);

    const result = await erase(100);
    expect(result).toEqual({ email: tombstoneEmail(targetId), name: ERASED_USER_NAME, removed: expectedRemoved });

    const [user] = await db.select().from(users).where(eq(users.id, targetId));
    expect(user).toMatchObject({ name: ERASED_USER_NAME, email: tombstoneEmail(targetId), isActive: false, erasedAt: 100 });
    // 消した後に数えると全部 0(数えた件数と実際に消した範囲が一致している)
    expect(Object.values(await countUserPersonalData(db, { tenantId, userId: targetId })).every((n) => n === 0)).toBe(true);
    // 他人のデータは残る
    expect(await countUserPersonalData(db, { tenantId, userId: otherId })).toMatchObject({ authCredentials: 1, slackUserLinks: 1, slackLinkTokens: 1 });
    expect((await db.select().from(slackLinkTokens)).map((t) => t.tokenHash)).toEqual(["t3"]);

    const logs = await db.select().from(auditLogs).where(eq(auditLogs.action, "member.erase"));
    expect(logs).toHaveLength(1);
    expect(JSON.parse(logs[0]?.afterDigest ?? "{}")).toEqual({ removed: expectedRemoved });
  });

  it("concurrent double erase: exactly one wins; the loser writes nothing (one audit log)", async () => {
    const results = await Promise.all([erase(100), erase(101)]);
    expect(results.filter((r) => r !== null)).toHaveLength(1);
    expect(await db.select().from(auditLogs).where(eq(auditLogs.action, "member.erase"))).toHaveLength(1);
    const [user] = await db.select().from(users).where(eq(users.id, targetId));
    expect([100, 101]).toContain(user?.erasedAt);
  });

  it("an already-erased user: returns null and writes nothing", async () => {
    await db.update(users).set({ erasedAt: 50 }).where(eq(users.id, targetId));
    expect(await erase(100)).toBeNull();
    const [user] = await db.select().from(users).where(eq(users.id, targetId));
    expect(user?.name).toBe("退職者");
    expect(user?.erasedAt).toBe(50);
    expect(await countUserPersonalData(db, { tenantId, userId: targetId })).toEqual(expectedRemoved);
    expect(await db.select().from(slackUserLinks)).toHaveLength(2);
    expect(await db.select().from(auditLogs).where(eq(auditLogs.action, "member.erase"))).toHaveLength(0);
  });
});
