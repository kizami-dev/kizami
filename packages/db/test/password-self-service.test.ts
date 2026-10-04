import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { migrateDb, supportsTransactions, type Database } from "./support/db.js";
import {
  acquirePasswordResetRequestSlot,
  changeOwnPassword,
  createPasswordResetToken,
  findPasswordResetTokenByHash,
  findSelfServiceResetTargetsByEmail,
  issueSelfServicePasswordResetToken,
  usePasswordResetToken,
} from "../src/queries/index.js";
import { auditLogs, authCredentials, sessions, tenants, users } from "../src/schema/index.js";
import { uuidv7 } from "../src/uuid.js";

// db.transaction() を通るクエリを含むため、D1 レグでは skip する(password-resets.test.ts と同じ理由)
describe.skipIf(!supportsTransactions)("password self-service queries", () => {
  let db: Database;
  const tenantA = uuidv7();
  const tenantB = uuidv7();

  beforeEach(async () => {
    const dbPath = join(tmpdir(), `kizami-db-test-${randomUUID()}.db`);
    ({ db } = await migrateDb({ url: `file:${dbPath}` }));
    await db.insert(tenants).values({ id: tenantA, name: "Tenant A", createdAt: 0 });
    await db.insert(tenants).values({ id: tenantB, name: "Tenant B", createdAt: 0 });
  });

  async function addUser(params: { tenantId: string; email: string; withCredential?: boolean; isActive?: boolean; createdAt?: number }) {
    const id = uuidv7();
    await db.insert(users).values({
      id,
      tenantId: params.tenantId,
      email: params.email,
      name: "U",
      isActive: params.isActive ?? true,
      createdAt: params.createdAt ?? 0,
    });
    if (params.withCredential ?? true) {
      await db.insert(authCredentials).values({ id: uuidv7(), tenantId: params.tenantId, userId: id, passwordHash: "old", createdAt: 0, updatedAt: 0 });
    }
    return id;
  }

  async function addSession(tenantId: string, userId: string, id: string) {
    await db.insert(sessions).values({ id, tenantId, userId, createdAt: 0, expiresAt: 100000, revokedAt: null });
  }

  describe("changeOwnPassword", () => {
    it("updates the hash, revokes every other session of the user (and only theirs), and writes an audit log", async () => {
      const me = await addUser({ tenantId: tenantA, email: "me@example.com" });
      const other = await addUser({ tenantId: tenantA, email: "other@example.com" });
      await addSession(tenantA, me, "keep");
      await addSession(tenantA, me, "drop-1");
      await addSession(tenantA, me, "drop-2");
      await addSession(tenantA, other, "others-session");

      const ok = await changeOwnPassword(db, { tenantId: tenantA, userId: me, passwordHash: "new", currentSessionId: "keep", nowMinutes: 77 });
      expect(ok).toBe(true);

      const [cred] = await db.select().from(authCredentials).where(eq(authCredentials.userId, me));
      expect(cred?.passwordHash).toBe("new");
      expect(cred?.updatedAt).toBe(77);

      const rows = await db.select().from(sessions);
      const revokedAt = (id: string) => rows.find((r) => r.id === id)?.revokedAt;
      expect(revokedAt("keep")).toBeNull();
      expect(revokedAt("drop-1")).toBe(77);
      expect(revokedAt("drop-2")).toBe(77);
      expect(revokedAt("others-session")).toBeNull();

      const logs = await db.select().from(auditLogs).where(eq(auditLogs.action, "auth.password_change"));
      expect(logs).toHaveLength(1);
      expect(logs[0]?.actorId).toBe(me);
      expect(logs[0]?.target).toBe(`user:${me}`);
    });

    it("returns false and writes nothing when the user has no credential (e.g. SSO only)", async () => {
      const sso = await addUser({ tenantId: tenantA, email: "sso@example.com", withCredential: false });
      await addSession(tenantA, sso, "s1");

      const ok = await changeOwnPassword(db, { tenantId: tenantA, userId: sso, passwordHash: "new", currentSessionId: "x", nowMinutes: 5 });
      expect(ok).toBe(false);
      expect((await db.select().from(sessions))[0]?.revokedAt).toBeNull();
      expect(await db.select().from(auditLogs)).toHaveLength(0);
    });
  });

  describe("findSelfServiceResetTargetsByEmail", () => {
    it("returns active users with a credential across tenants, oldest first; excludes inactive and credential-less users", async () => {
      const b = await addUser({ tenantId: tenantB, email: "x@example.com", createdAt: 20 });
      const a = await addUser({ tenantId: tenantA, email: "x@example.com", createdAt: 10 });
      await addUser({ tenantId: tenantA, email: "gone@example.com", isActive: false });
      await addUser({ tenantId: tenantA, email: "sso@example.com", withCredential: false });

      const targets = await findSelfServiceResetTargetsByEmail(db, "x@example.com");
      expect(targets).toEqual([
        { tenantId: tenantA, userId: a },
        { tenantId: tenantB, userId: b },
      ]);
      expect(await findSelfServiceResetTargetsByEmail(db, "gone@example.com")).toEqual([]);
      expect(await findSelfServiceResetTargetsByEmail(db, "sso@example.com")).toEqual([]);
      expect(await findSelfServiceResetTargetsByEmail(db, "nobody@example.com")).toEqual([]);
    });

    it("matches the email exactly (case-sensitive), like POST /auth/login", async () => {
      await addUser({ tenantId: tenantA, email: "Mixed@Example.com" });
      expect(await findSelfServiceResetTargetsByEmail(db, "Mixed@Example.com")).toHaveLength(1);
      expect(await findSelfServiceResetTargetsByEmail(db, "mixed@example.com")).toHaveLength(0);
    });
  });

  describe("acquirePasswordResetRequestSlot", () => {
    it("allows the first request, suppresses within the window, and allows again once the window has passed", async () => {
      const slot = (nowMinutes: number) => acquirePasswordResetRequestSlot(db, { emailKey: "a@example.com", nowMinutes, throttleMinutes: 5 });
      expect(await slot(100)).toBe(true);
      expect(await slot(101)).toBe(false);
      expect(await slot(104)).toBe(false);
      expect(await slot(105)).toBe(true);
      // 抑止された試行は時刻を更新しない(105 から再び 5 分)
      expect(await slot(109)).toBe(false);
      expect(await slot(110)).toBe(true);
    });

    it("is keyed per email", async () => {
      expect(await acquirePasswordResetRequestSlot(db, { emailKey: "a@example.com", nowMinutes: 1, throttleMinutes: 5 })).toBe(true);
      expect(await acquirePasswordResetRequestSlot(db, { emailKey: "b@example.com", nowMinutes: 1, throttleMinutes: 5 })).toBe(true);
    });

    it("lets exactly one of many concurrent requests through", async () => {
      const results = await Promise.all(
        Array.from({ length: 8 }, () => acquirePasswordResetRequestSlot(db, { emailKey: "race@example.com", nowMinutes: 50, throttleMinutes: 5 })),
      );
      expect(results.filter(Boolean)).toHaveLength(1);
    });
  });

  describe("issueSelfServicePasswordResetToken", () => {
    it("creates a self-sourced token created by the user, and writes a password_reset.self_request audit log", async () => {
      const u = await addUser({ tenantId: tenantA, email: "u@example.com" });
      const token = await issueSelfServicePasswordResetToken(db, { tenantId: tenantA, userId: u, tokenHash: "h1", expiresAt: 60, createdAt: 0 });
      expect(token.source).toBe("self");
      expect(token.createdBy).toBe(u);

      const logs = await db.select().from(auditLogs).where(eq(auditLogs.action, "password_reset.self_request"));
      expect(logs).toHaveLength(1);
      expect(logs[0]?.actorId).toBe(u);
      expect(logs[0]?.target).toBe(`user:${u}`);
    });

    it("revokes the user's older self-issued token, but leaves an admin-issued token and other users' tokens alone", async () => {
      const u = await addUser({ tenantId: tenantA, email: "u@example.com" });
      const v = await addUser({ tenantId: tenantA, email: "v@example.com" });
      const admin = await createPasswordResetToken(db, { tenantId: tenantA, userId: u, tokenHash: "admin-h", expiresAt: 1440, createdBy: v, createdAt: 0 });
      expect(admin.source).toBe("admin");
      const old = await issueSelfServicePasswordResetToken(db, { tenantId: tenantA, userId: u, tokenHash: "old-h", expiresAt: 60, createdAt: 1 });
      const vToken = await issueSelfServicePasswordResetToken(db, { tenantId: tenantA, userId: v, tokenHash: "v-h", expiresAt: 60, createdAt: 1 });

      await issueSelfServicePasswordResetToken(db, { tenantId: tenantA, userId: u, tokenHash: "new-h", expiresAt: 70, createdAt: 10 });

      expect((await findPasswordResetTokenByHash(db, "old-h"))?.revokedAt).toBe(10);
      expect((await findPasswordResetTokenByHash(db, old.tokenHash))?.id).toBe(old.id);
      expect((await findPasswordResetTokenByHash(db, "admin-h"))?.revokedAt).toBeNull();
      expect((await findPasswordResetTokenByHash(db, vToken.tokenHash))?.revokedAt).toBeNull();
      expect((await findPasswordResetTokenByHash(db, "new-h"))?.revokedAt).toBeNull();
    });

    it("an admin reissue still revokes self-issued tokens (all unresolved tokens)", async () => {
      const u = await addUser({ tenantId: tenantA, email: "u@example.com" });
      await issueSelfServicePasswordResetToken(db, { tenantId: tenantA, userId: u, tokenHash: "self-h", expiresAt: 60, createdAt: 0 });
      await createPasswordResetToken(db, { tenantId: tenantA, userId: u, tokenHash: "admin-h", expiresAt: 1440, createdBy: u, createdAt: 5 });
      expect((await findPasswordResetTokenByHash(db, "self-h"))?.revokedAt).toBe(5);
    });

    it("a self-issued token is used by usePasswordResetToken like an admin one (all sessions revoked), recording the source", async () => {
      const u = await addUser({ tenantId: tenantA, email: "u@example.com" });
      await addSession(tenantA, u, "s1");
      await issueSelfServicePasswordResetToken(db, { tenantId: tenantA, userId: u, tokenHash: "self-h", expiresAt: 60, createdAt: 0 });

      const used = await usePasswordResetToken(db, { tokenHash: "self-h", passwordHash: "new", nowMinutes: 30 });
      expect(used?.userId).toBe(u);
      expect((await db.select().from(sessions))[0]?.revokedAt).toBe(30);

      const logs = await db.select().from(auditLogs).where(eq(auditLogs.action, "password_reset.use"));
      expect(JSON.parse(logs[0]?.afterDigest ?? "{}")).toEqual({ source: "self" });
    });
  });
});
