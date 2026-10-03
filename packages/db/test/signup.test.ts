import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { migrateDb, supportsTransactions, type Database } from "./support/db.js";
import {
  consumePendingSignup,
  consumeSignupInviteCode,
  createSignupInviteCode,
  deleteStalePendingSignups,
  findLatestUnconsumedPendingSignupByEmail,
  findPendingSignupByTokenHash,
  findSignupInviteCodeByHash,
  isSignupInviteCodeUsable,
  listSignupInviteCodes,
  listTenantsWithActiveUserCount,
  replacePendingSignup,
  revokeSignupInviteCode,
} from "../src/queries/index.js";
import { tenants, users } from "../src/schema/index.js";
import { uuidv7 } from "../src/uuid.js";

// replacePendingSignup が db.transaction() を使うため、D1 レグでは skip する
// (invitations.test.ts と同じ理由)
describe.skipIf(!supportsTransactions)("signup system tables", () => {
  let db: Database;

  beforeEach(async () => {
    const dbPath = join(tmpdir(), `kizami-db-test-${randomUUID()}.db`);
    ({ db } = await migrateDb({ url: `file:${dbPath}` }));
  });

  async function newCode(overrides: Partial<Parameters<typeof createSignupInviteCode>[1]> = {}) {
    return createSignupInviteCode(db, {
      codeHash: `hash-${uuidv7()}`,
      note: null,
      maxUses: 1,
      expiresAt: null,
      createdAt: 0,
      ...overrides,
    });
  }

  const pending = (overrides: Partial<Parameters<typeof replacePendingSignup>[1]> = {}) => ({
    email: "a@example.com",
    organizationName: "A社",
    adminName: "管理者A",
    tokenHash: `t-${uuidv7()}`,
    inviteCodeId: null,
    expiresAt: 1000,
    createdAt: 0,
    ...overrides,
  });

  it("招待コード: 作成・ハッシュ検索・一覧", async () => {
    const code = await newCode({ codeHash: "h1", note: "友人A" });
    expect(code.usedCount).toBe(0);
    expect((await findSignupInviteCodeByHash(db, "h1"))?.id).toBe(code.id);
    expect(await findSignupInviteCodeByHash(db, "nope")).toBeNull();
    expect(await listSignupInviteCodes(db)).toHaveLength(1);
  });

  it("消費は上限・失効・期限を条件付き UPDATE で守る", async () => {
    const code = await newCode({ maxUses: 2, expiresAt: 1000 });
    expect(await consumeSignupInviteCode(db, { id: code.id, nowMinutes: 10 })).toBe(true);
    expect(await consumeSignupInviteCode(db, { id: code.id, nowMinutes: 10 })).toBe(true);
    expect(await consumeSignupInviteCode(db, { id: code.id, nowMinutes: 10 })).toBe(false);

    const expiring = await newCode({ expiresAt: 100 });
    expect(await consumeSignupInviteCode(db, { id: expiring.id, nowMinutes: 100 })).toBe(false);

    const revoked = await newCode();
    expect((await revokeSignupInviteCode(db, { id: revoked.id, revokedAt: 5 }))?.revokedAt).toBe(5);
    expect(await revokeSignupInviteCode(db, { id: revoked.id, revokedAt: 6 })).toBeNull();
    expect(await consumeSignupInviteCode(db, { id: revoked.id, nowMinutes: 10 })).toBe(false);
  });

  it("isSignupInviteCodeUsable は消費せずに有効性だけ判定する", async () => {
    const code = await newCode({ maxUses: 1, expiresAt: 100 });
    expect(isSignupInviteCodeUsable(code, 10)).toBe(true);
    expect(isSignupInviteCodeUsable(code, 100)).toBe(false);
    expect(isSignupInviteCodeUsable({ ...code, usedCount: 1 }, 10)).toBe(false);
    expect(isSignupInviteCodeUsable({ ...code, revokedAt: 1 }, 10)).toBe(false);
  });

  it("同一メールの未消費 pending は発行し直しで置き換わる", async () => {
    const first = await replacePendingSignup(db, pending({ tokenHash: "t1" }));
    const second = await replacePendingSignup(db, pending({ tokenHash: "t2" }));
    expect(await findPendingSignupByTokenHash(db, "t1")).toBeNull();
    expect((await findPendingSignupByTokenHash(db, "t2"))?.id).toBe(second.id);
    expect(first.id).not.toBe(second.id);
    // 別メールは影響を受けない
    await replacePendingSignup(db, pending({ email: "b@example.com", tokenHash: "t3" }));
    expect(await findPendingSignupByTokenHash(db, "t2")).not.toBeNull();
  });

  it("findLatestUnconsumedPendingSignupByEmail は未消費の最新だけを返す", async () => {
    expect(await findLatestUnconsumedPendingSignupByEmail(db, "a@example.com")).toBeNull();
    const row = await replacePendingSignup(db, pending({ createdAt: 7 }));
    expect((await findLatestUnconsumedPendingSignupByEmail(db, "a@example.com"))?.id).toBe(row.id);
    await consumePendingSignup(db, { id: row.id, nowMinutes: 8 });
    expect(await findLatestUnconsumedPendingSignupByEmail(db, "a@example.com")).toBeNull();
  });

  it("consumePendingSignup は1回だけ成功し、期限切れは失敗する", async () => {
    const row = await replacePendingSignup(db, pending());
    expect(await consumePendingSignup(db, { id: row.id, nowMinutes: 10 })).not.toBeNull();
    expect(await consumePendingSignup(db, { id: row.id, nowMinutes: 11 })).toBeNull();
    const expired = await replacePendingSignup(db, pending({ email: "c@example.com", expiresAt: 50 }));
    expect(await consumePendingSignup(db, { id: expired.id, nowMinutes: 50 })).toBeNull();
  });

  it("deleteStalePendingSignups は期限切れの未消費だけを消す", async () => {
    const stale = await replacePendingSignup(db, pending({ email: "s@example.com", expiresAt: 10 }));
    const fresh = await replacePendingSignup(db, pending({ email: "f@example.com", expiresAt: 500 }));
    const consumed = await replacePendingSignup(db, pending({ email: "k@example.com", expiresAt: 10 }));
    await consumePendingSignup(db, { id: consumed.id, nowMinutes: 5 });

    expect(await deleteStalePendingSignups(db, { expiredBefore: 100 })).toBe(1);
    expect(await findPendingSignupByTokenHash(db, stale.tokenHash)).toBeNull();
    expect(await findPendingSignupByTokenHash(db, fresh.tokenHash)).not.toBeNull();
    // 消費済み(テナント作成の記録)は期限が過ぎていても残す
    expect(await findPendingSignupByTokenHash(db, consumed.tokenHash)).not.toBeNull();
  });

  it("listTenantsWithActiveUserCount は有効ユーザー数だけ数える", async () => {
    const t = uuidv7();
    await db.insert(tenants).values({ id: t, name: "T", createdAt: 1 });
    await db.insert(tenants).values({ id: uuidv7(), name: "Empty", createdAt: 2 });
    await db.insert(users).values({ id: uuidv7(), tenantId: t, email: "a@x.com", name: "a", createdAt: 1 });
    await db.insert(users).values({ id: uuidv7(), tenantId: t, email: "b@x.com", name: "b", isActive: false, createdAt: 1 });
    const rows = await listTenantsWithActiveUserCount(db);
    expect(rows.map((r) => [r.name, r.activeUserCount])).toEqual([
      ["T", 1],
      ["Empty", 0],
    ]);
  });
});
