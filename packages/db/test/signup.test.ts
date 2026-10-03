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
  findPendingSignupByTokenHash,
  findSignupInviteCodeByHash,
  isSignupInviteCodeUsable,
  listSignupInviteCodes,
  listTenantsWithActiveUserCount,
  upsertPendingSignupUnlessRecent,
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

  const pending = (overrides: Partial<Parameters<typeof upsertPendingSignupUnlessRecent>[1]> = {}) => ({
    email: "a@example.com",
    emailKey: overrides.email?.toLowerCase() ?? "a@example.com",
    organizationName: "A社",
    adminName: "管理者A",
    tokenHash: `t-${uuidv7()}`,
    inviteCodeId: null,
    expiresAt: 1000,
    createdAt: 0,
    ...overrides,
  });

  /** 抑止なし(throttle 0 分)で作る。置き換え・消費・掃除のテスト用。 */
  async function upsert(input: ReturnType<typeof pending>) {
    const row = await upsertPendingSignupUnlessRecent(db, input, { throttleMinutes: 0 });
    if (!row) throw new Error("unexpected throttle");
    return row;
  }

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
    const first = await upsert(pending({ tokenHash: "t1" }));
    const second = await upsert(pending({ tokenHash: "t2" }));
    expect(await findPendingSignupByTokenHash(db, "t1")).toBeNull();
    expect((await findPendingSignupByTokenHash(db, "t2"))?.id).toBe(second.id);
    expect(first.id).not.toBe(second.id);
    // 別メールは影響を受けない
    await upsert(pending({ email: "b@example.com", tokenHash: "t3" }));
    expect(await findPendingSignupByTokenHash(db, "t2")).not.toBeNull();
  });

  it("upsertPendingSignupUnlessRecent: 直近(throttle 以内)の未消費があれば何もせず null、古ければ置き換える", async () => {
    const first = await upsertPendingSignupUnlessRecent(db, pending({ tokenHash: "t1", createdAt: 100 }), { throttleMinutes: 5 });
    expect(first).not.toBeNull();
    // 5分以内(境界の手前)は抑止され、既存行は変わらない
    expect(await upsertPendingSignupUnlessRecent(db, pending({ tokenHash: "t2", createdAt: 104 }), { throttleMinutes: 5 })).toBeNull();
    expect(await findPendingSignupByTokenHash(db, "t1")).not.toBeNull();
    expect(await findPendingSignupByTokenHash(db, "t2")).toBeNull();
    // ちょうど5分経てば置き換わる(古いリンクは無効)
    const replaced = await upsertPendingSignupUnlessRecent(db, pending({ tokenHash: "t3", createdAt: 105 }), { throttleMinutes: 5 });
    expect(replaced?.tokenHash).toBe("t3");
    expect(await findPendingSignupByTokenHash(db, "t1")).toBeNull();
  });

  it("照合キー(emailKey)が同じなら大文字小文字違いでも同一扱い。email は入力どおり残る", async () => {
    await upsertPendingSignupUnlessRecent(db, pending({ email: "Victim@Example.com", tokenHash: "t1", createdAt: 100 }), { throttleMinutes: 5 });
    const second = await upsertPendingSignupUnlessRecent(db, pending({ email: "victim@example.com", tokenHash: "t2", createdAt: 101 }), {
      throttleMinutes: 5,
    });
    expect(second).toBeNull();
    expect((await findPendingSignupByTokenHash(db, "t1"))?.email).toBe("Victim@Example.com");
  });

  it("消費済みの行は部分 UNIQUE の対象外: 同じメールで新しい pending を作れる", async () => {
    const first = await upsert(pending({ tokenHash: "t1" }));
    await consumePendingSignup(db, { id: first.id, nowMinutes: 1 });
    const second = await upsertPendingSignupUnlessRecent(db, pending({ tokenHash: "t2", createdAt: 1 }), { throttleMinutes: 5 });
    expect(second?.tokenHash).toBe("t2");
    expect(await findPendingSignupByTokenHash(db, "t1")).not.toBeNull();
  });

  it("同時に呼んでも行を得るのは1本だけ(原子的)", async () => {
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) => upsertPendingSignupUnlessRecent(db, pending({ tokenHash: `race-${i}`, createdAt: 100 }), { throttleMinutes: 5 })),
    );
    expect(results.filter((r) => r !== null)).toHaveLength(1);
  });

  it("consumePendingSignup は1回だけ成功し、期限切れは失敗する", async () => {
    const row = await upsert(pending());
    expect(await consumePendingSignup(db, { id: row.id, nowMinutes: 10 })).not.toBeNull();
    expect(await consumePendingSignup(db, { id: row.id, nowMinutes: 11 })).toBeNull();
    const expired = await upsert(pending({ email: "c@example.com", expiresAt: 50 }));
    expect(await consumePendingSignup(db, { id: expired.id, nowMinutes: 50 })).toBeNull();
  });

  it("deleteStalePendingSignups は期限切れの未消費だけを消す", async () => {
    const stale = await upsert(pending({ email: "s@example.com", expiresAt: 10 }));
    const fresh = await upsert(pending({ email: "f@example.com", expiresAt: 500 }));
    const consumed = await upsert(pending({ email: "k@example.com", expiresAt: 10 }));
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
