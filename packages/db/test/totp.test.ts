/**
 * 2FA(TOTP)の書き込み一式(atomic plan、2026-10-08、docs/design/d1-atomic-writes.md #20〜#22・#25)。
 * apps/api の POST /auth/totp/enable・disable・recovery-codes と POST /members/:id/two-factor/reset が
 * 使う関数を、3レグ(SQLite / PostgreSQL / D1)で確かめる。
 */
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { migrateDb, type Database } from "./support/db.js";
import {
  countUnusedRecoveryCodes,
  enableUserTotpWithRecoveryCodes,
  getUserTotp,
  regenerateRecoveryCodes,
  removeUserTotp,
  upsertPendingUserTotp,
} from "../src/queries/index.js";
import { auditLogs, notifications, tenants, userTotpRecoveryCodes, users } from "../src/schema/index.js";
import { uuidv7 } from "../src/uuid.js";

describe("totp writes on the atomic plan", () => {
  let db: Database;
  const tenantId = uuidv7();
  const userId = uuidv7();
  const adminId = uuidv7();

  beforeEach(async () => {
    // 書き込みの単位(SQLite は batch)を通常の SELECT と混ぜて呼ぶため、ファイルバックエンドにする
    // (invitations.test.ts と同じ理由)
    const dbPath = join(tmpdir(), `kizami-db-test-${randomUUID()}.db`);
    ({ db } = await migrateDb({ url: `file:${dbPath}` }));
    await db.insert(tenants).values({ id: tenantId, name: "Tenant A", createdAt: 0 });
    await db.insert(users).values([
      { id: userId, tenantId, email: "u@example.com", name: "U", createdAt: 0 },
      { id: adminId, tenantId, email: "admin@example.com", name: "Admin", createdAt: 0 },
    ]);
  });

  const hashes = (prefix: string, n = 10) => Array.from({ length: n }, (_, i) => `${prefix}-${i}`);
  const codeHashesInDb = async () =>
    (await db.select().from(userTotpRecoveryCodes).where(eq(userTotpRecoveryCodes.userId, userId))).map((r) => r.codeHash).sort();
  const auditCount = async (action: string) => (await db.select().from(auditLogs).where(eq(auditLogs.action, action))).length;

  describe("enableUserTotpWithRecoveryCodes", () => {
    it("enables the pending row, stores the recovery codes and writes auth.totp.enable", async () => {
      await upsertPendingUserTotp(db, { tenantId, userId, secretEncrypted: "enc:v1:x", createdAt: 0 });
      expect(await enableUserTotpWithRecoveryCodes(db, { tenantId, userId, enabledAt: 10, lastUsedCounter: 7, codeHashes: hashes("a") })).toBe(true);

      const row = await getUserTotp(db, { tenantId, userId });
      expect(row?.enabledAt).toBe(10);
      expect(row?.lastUsedCounter).toBe(7);
      expect(await codeHashesInDb()).toEqual(hashes("a").sort());
      expect(await auditCount("auth.totp.enable")).toBe(1);
    });

    it("concurrent enables: exactly one wins; only the winner's recovery codes remain, one audit log", async () => {
      await upsertPendingUserTotp(db, { tenantId, userId, secretEncrypted: "enc:v1:x", createdAt: 0 });
      const results = await Promise.all([
        enableUserTotpWithRecoveryCodes(db, { tenantId, userId, enabledAt: 10, lastUsedCounter: 1, codeHashes: hashes("a") }),
        enableUserTotpWithRecoveryCodes(db, { tenantId, userId, enabledAt: 10, lastUsedCounter: 1, codeHashes: hashes("b") }),
      ]);
      expect(results.filter(Boolean)).toHaveLength(1);
      const winner = results[0] ? "a" : "b";
      expect(await codeHashesInDb()).toEqual(hashes(winner).sort());
      expect(await auditCount("auth.totp.enable")).toBe(1);
    });

    it("a lost claim (already enabled, or no setup row) writes nothing", async () => {
      // セットアップ行が無い
      expect(await enableUserTotpWithRecoveryCodes(db, { tenantId, userId, enabledAt: 5, lastUsedCounter: 1, codeHashes: hashes("x") })).toBe(false);
      expect(await codeHashesInDb()).toEqual([]);

      // 既に有効
      await upsertPendingUserTotp(db, { tenantId, userId, secretEncrypted: "enc:v1:x", createdAt: 0 });
      expect(await enableUserTotpWithRecoveryCodes(db, { tenantId, userId, enabledAt: 10, lastUsedCounter: 1, codeHashes: hashes("a") })).toBe(true);
      expect(await enableUserTotpWithRecoveryCodes(db, { tenantId, userId, enabledAt: 20, lastUsedCounter: 9, codeHashes: hashes("b") })).toBe(false);
      const row = await getUserTotp(db, { tenantId, userId });
      expect(row?.enabledAt).toBe(10);
      expect(row?.lastUsedCounter).toBe(1);
      expect(await codeHashesInDb()).toEqual(hashes("a").sort());
      expect(await auditCount("auth.totp.enable")).toBe(1);
    });

    it("splits a large set of recovery codes into statements under D1's 100-bound-parameter limit", async () => {
      await upsertPendingUserTotp(db, { tenantId, userId, secretEncrypted: "enc:v1:x", createdAt: 0 });
      // 6 列 × 40 行 = 240 個(1文なら D1 で落ちる)
      expect(await enableUserTotpWithRecoveryCodes(db, { tenantId, userId, enabledAt: 10, lastUsedCounter: 1, codeHashes: hashes("big", 40) })).toBe(true);
      expect(await countUnusedRecoveryCodes(db, { tenantId, userId })).toBe(40);
    });
  });

  it("regenerateRecoveryCodes replaces every old code (used ones too) and writes the audit log", async () => {
    await upsertPendingUserTotp(db, { tenantId, userId, secretEncrypted: "enc:v1:x", createdAt: 0 });
    await enableUserTotpWithRecoveryCodes(db, { tenantId, userId, enabledAt: 10, lastUsedCounter: 1, codeHashes: hashes("old") });
    await db
      .update(userTotpRecoveryCodes)
      .set({ consumedAt: 11 })
      .where(and(eq(userTotpRecoveryCodes.userId, userId), eq(userTotpRecoveryCodes.codeHash, "old-0")));

    await regenerateRecoveryCodes(db, { tenantId, userId, codeHashes: hashes("new"), createdAt: 20 });
    expect(await codeHashesInDb()).toEqual(hashes("new").sort());
    expect(await auditCount("auth.totp.recovery_codes.regenerate")).toBe(1);
  });

  describe("removeUserTotp", () => {
    it("deletes the TOTP row and recovery codes with the audit log (self-service disable)", async () => {
      await upsertPendingUserTotp(db, { tenantId, userId, secretEncrypted: "enc:v1:x", createdAt: 0 });
      await enableUserTotpWithRecoveryCodes(db, { tenantId, userId, enabledAt: 10, lastUsedCounter: 1, codeHashes: hashes("a") });

      await removeUserTotp(db, {
        tenantId,
        userId,
        audit: { tenantId, actorId: userId, action: "auth.totp.disable", targetType: "users", targetId: userId, detail: "{}", occurredAt: 20 },
      });
      expect(await getUserTotp(db, { tenantId, userId })).toBeNull();
      expect(await codeHashesInDb()).toEqual([]);
      expect(await auditCount("auth.totp.disable")).toBe(1);
      expect(await db.select().from(notifications)).toHaveLength(0);
    });

    it("an admin reset also notifies the user, and a duplicate notification key is skipped instead of failing the whole unit", async () => {
      await upsertPendingUserTotp(db, { tenantId, userId, secretEncrypted: "enc:v1:x", createdAt: 0 });
      const notification = {
        tenantId,
        userId,
        type: "security_totp_reset",
        subjectDate: "2026-10-08",
        title: "t",
        body: "b",
        createdAt: 20,
      };
      const reset = () =>
        removeUserTotp(db, {
          tenantId,
          userId,
          audit: { tenantId, actorId: adminId, action: "member.totp.reset", targetType: "user", targetId: userId, detail: "{}", occurredAt: 20 },
          notification,
        });
      await reset();
      expect(await db.select().from(notifications)).toHaveLength(1);
      // 同じ (tenant, user, type, subject_date) の2回目: createNotificationIfAbsent と同じく通知は作らないが、
      // 削除と監査ログは書かれる(UNIQUE 違反で計画全体が落ちない)
      await upsertPendingUserTotp(db, { tenantId, userId, secretEncrypted: "enc:v1:y", createdAt: 21 });
      await reset();
      expect(await db.select().from(notifications)).toHaveLength(1);
      expect(await getUserTotp(db, { tenantId, userId })).toBeNull();
      expect(await auditCount("member.totp.reset")).toBe(2);
    });
  });
});
