import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { migrateDb, type Database } from "./support/db.js";
import {
  findValidSlackLinkTokenByHash,
  getSlackUserLinkBySlackUserId,
  getSlackUserLinkByUserId,
  getTenantSlackSettings,
  findTenantSlackSettingsByTeamId,
  insertSlackLinkToken,
  linkSlackUser,
  markSlackLinkTokenUsed,
  markTenantSlackTeamVerified,
  upsertTenantSlackSettings,
} from "../src/queries/slack.js";
import { slackUserLinks, tenants, users } from "../src/schema/index.js";
import { uuidv7 } from "../src/uuid.js";

describe("slack settings queries", () => {
  let db: Database;
  const tenantId = uuidv7();
  const userId = uuidv7();

  beforeEach(async () => {
    // linkSlackUser は atomic plan(SQLite では batch)で書く(packages/db/src/queries/slack.ts)。
    // @libsql/client のローカル sqlite3 ドライバはトランザクション実行後にネイティブ接続を
    // 手放し、次回アクセス時に遅延再接続する。`:memory:` だと再接続 = 新規の空DBになりデータが
    // 消える(test/corrections.test.ts と同じ既知の制約)ため、ファイルバックエンドを使う。
    const dbPath = join(tmpdir(), `kizami-db-test-${randomUUID()}.db`);
    ({ db } = await migrateDb({ url: `file:${dbPath}` }));
    await db.insert(tenants).values({ id: tenantId, name: "Tenant A", createdAt: 0 });
    await db.insert(users).values({ id: userId, tenantId, email: "admin@example.com", name: "Admin", createdAt: 0 });
  });

  it("getTenantSlackSettings returns null when nothing has been configured yet", async () => {
    expect(await getTenantSlackSettings(db, tenantId)).toBeNull();
  });

  it("upsertTenantSlackSettings creates then replaces the single row per tenant", async () => {
    const created = await upsertTenantSlackSettings(db, {
      tenantId,
      teamId: "T0000001",
      signingSecret: "enc:v1:aaaa:bbbb",
      enabled: true,
      updatedAt: 100,
      updatedBy: userId,
    });
    expect(created.teamId).toBe("T0000001");
    expect(created.enabled).toBe(true);

    const updated = await upsertTenantSlackSettings(db, {
      tenantId,
      teamId: "T0000002",
      signingSecret: null,
      enabled: false,
      updatedAt: 200,
      updatedBy: userId,
    });
    expect(updated.teamId).toBe("T0000002");
    expect(updated.signingSecret).toBeNull();
    expect(updated.enabled).toBe(false);

    const fetched = await getTenantSlackSettings(db, tenantId);
    expect(fetched?.teamId).toBe("T0000002");
  });

  it("findTenantSlackSettingsByTeamId returns an unverified team_id as a pending candidate", async () => {
    await upsertTenantSlackSettings(db, {
      tenantId,
      teamId: "T0000001",
      signingSecret: null,
      enabled: true,
      updatedAt: 100,
      updatedBy: userId,
    });

    const found = await findTenantSlackSettingsByTeamId(db, "T0000001");
    expect(found.verified).toBeNull();
    expect(found.pending.map((row) => row.tenantId)).toEqual([tenantId]);
    expect(await findTenantSlackSettingsByTeamId(db, "T-unknown")).toEqual({ verified: null, pending: [] });
  });

  describe("team_id の先取り対策(確認済みの行だけ UNIQUE)", () => {
    let squatterTenantId: string;
    let squatterUserId: string;
    beforeEach(async () => {
      squatterTenantId = uuidv7();
      squatterUserId = uuidv7();
      await db.insert(tenants).values({ id: squatterTenantId, name: "Squatter", createdAt: 0 });
      await db.insert(users).values({ id: squatterUserId, tenantId: squatterTenantId, email: "s@example.com", name: "S", createdAt: 0 });
    });
    const save = (t: string, u: string, teamIdVerifiedAt: number | null = null) =>
      upsertTenantSlackSettings(db, { tenantId: t, teamId: "T-SHARED", teamIdVerifiedAt, signingSecret: null, enabled: true, updatedAt: 1, updatedBy: u });

    it("another tenant entering the same team_id first does not block the owner from saving it", async () => {
      await save(squatterTenantId, squatterUserId);
      await expect(save(tenantId, userId)).resolves.toBeDefined();
      const found = await findTenantSlackSettingsByTeamId(db, "T-SHARED");
      expect(found.pending.map((row) => row.tenantId).sort()).toEqual([tenantId, squatterTenantId].sort());
    });

    it("once verified, only that tenant is returned and nobody else can also verify the same team_id", async () => {
      await save(squatterTenantId, squatterUserId);
      await save(tenantId, userId);
      expect(await markTenantSlackTeamVerified(db, { tenantId, teamId: "T-SHARED", verifiedAt: 5 })).toBe(true);

      const found = await findTenantSlackSettingsByTeamId(db, "T-SHARED");
      expect(found.verified?.tenantId).toBe(tenantId);
      expect(found.pending).toEqual([]);
      expect(await markTenantSlackTeamVerified(db, { tenantId: squatterTenantId, teamId: "T-SHARED", verifiedAt: 6 })).toBe(false);
      // 確認済みの行の再確認も false(既に立っている)
      expect(await markTenantSlackTeamVerified(db, { tenantId, teamId: "T-SHARED", verifiedAt: 7 })).toBe(false);
    });

    it("changing team_id via upsert resets the verification (teamIdVerifiedAt omitted = null)", async () => {
      await save(tenantId, userId, 5);
      const updated = await upsertTenantSlackSettings(db, {
        tenantId,
        teamId: "T-OTHER",
        signingSecret: null,
        enabled: true,
        updatedAt: 2,
        updatedBy: userId,
      });
      expect(updated.teamIdVerifiedAt).toBeNull();
    });
  });

  it("multiple tenants can each leave team_id unset (null) without violating uniqueness", async () => {
    const otherTenantId = uuidv7();
    await db.insert(tenants).values({ id: otherTenantId, name: "Tenant B", createdAt: 0 });
    const otherUserId = uuidv7();
    await db.insert(users).values({ id: otherUserId, tenantId: otherTenantId, email: "b@example.com", name: "B", createdAt: 0 });

    await upsertTenantSlackSettings(db, {
      tenantId,
      teamId: null,
      signingSecret: null,
      enabled: false,
      updatedAt: 0,
      updatedBy: userId,
    });
    await expect(
      upsertTenantSlackSettings(db, {
        tenantId: otherTenantId,
        teamId: null,
        signingSecret: null,
        enabled: false,
        updatedAt: 0,
        updatedBy: otherUserId,
      }),
    ).resolves.toBeDefined();
  });

  describe("slack_user_links", () => {
    it("getSlackUserLinkBySlackUserId / getSlackUserLinkByUserId return null when unlinked", async () => {
      expect(await getSlackUserLinkBySlackUserId(db, { tenantId, slackUserId: "U123" })).toBeNull();
      expect(await getSlackUserLinkByUserId(db, { tenantId, userId })).toBeNull();
    });

    // linkSlackUser は atomic plan で書くので D1 レグでも走る(2026-10-08、docs/design/d1-atomic-writes.md #8)
    it("linkSlackUser links a slack user to a kizami user and both lookups find it", async () => {
      const link = await linkSlackUser(db, { tenantId, slackUserId: "U123", userId, linkedAt: 100 });
      expect(link.slackUserId).toBe("U123");
      expect(link.userId).toBe(userId);

      expect((await getSlackUserLinkBySlackUserId(db, { tenantId, slackUserId: "U123" }))?.userId).toBe(userId);
      expect((await getSlackUserLinkByUserId(db, { tenantId, userId }))?.slackUserId).toBe("U123");
    });

    it("re-linking the same slack_user_id to a different kizami user replaces the target (last link wins)", async () => {
      const otherUserId = uuidv7();
      await db.insert(users).values({ id: otherUserId, tenantId, email: "c@example.com", name: "C", createdAt: 0 });

      await linkSlackUser(db, { tenantId, slackUserId: "U123", userId, linkedAt: 100 });
      const relinked = await linkSlackUser(db, { tenantId, slackUserId: "U123", userId: otherUserId, linkedAt: 200 });
      expect(relinked.userId).toBe(otherUserId);

      expect((await getSlackUserLinkBySlackUserId(db, { tenantId, slackUserId: "U123" }))?.userId).toBe(otherUserId);
      // 元のユーザーの連携は消える(1kizamiユーザーにつき1Slackアカウントの制約を保つため)
      expect(await getSlackUserLinkByUserId(db, { tenantId, userId })).toBeNull();
    });

    it("re-linking the same kizami user to a different slack account replaces the old mapping (one slack account per user)", async () => {
      await linkSlackUser(db, { tenantId, slackUserId: "U123", userId, linkedAt: 100 });
      const relinked = await linkSlackUser(db, { tenantId, slackUserId: "U456", userId, linkedAt: 200 });
      expect(relinked.slackUserId).toBe("U456");

      expect(await getSlackUserLinkBySlackUserId(db, { tenantId, slackUserId: "U123" })).toBeNull();
      expect((await getSlackUserLinkByUserId(db, { tenantId, userId }))?.slackUserId).toBe("U456");

      const all = await db.select().from(slackUserLinks).where(eq(slackUserLinks.tenantId, tenantId));
      expect(all).toHaveLength(1);
    });
  });

  describe("slack_link_tokens", () => {
    it("findValidSlackLinkTokenByHash returns the token when unused and unexpired", async () => {
      await insertSlackLinkToken(db, { tenantId, slackUserId: "U123", tokenHash: "hash-1", expiresAt: 1000, createdAt: 0 });

      const found = await findValidSlackLinkTokenByHash(db, "hash-1", 500);
      expect(found).not.toBeNull();
      expect(found?.slackUserId).toBe("U123");
    });

    it("findValidSlackLinkTokenByHash returns null once expired", async () => {
      await insertSlackLinkToken(db, { tenantId, slackUserId: "U123", tokenHash: "hash-expiring", expiresAt: 1000, createdAt: 0 });

      expect(await findValidSlackLinkTokenByHash(db, "hash-expiring", 1000)).toBeNull();
      expect(await findValidSlackLinkTokenByHash(db, "hash-expiring", 1001)).toBeNull();
    });

    it("findValidSlackLinkTokenByHash returns null once used, and markSlackLinkTokenUsed is what causes that", async () => {
      const created = await insertSlackLinkToken(db, {
        tenantId,
        slackUserId: "U123",
        tokenHash: "hash-used",
        expiresAt: 10_000,
        createdAt: 0,
      });

      expect(await findValidSlackLinkTokenByHash(db, "hash-used", 500)).not.toBeNull();
      await markSlackLinkTokenUsed(db, { id: created.id, usedAt: 500 });
      expect(await findValidSlackLinkTokenByHash(db, "hash-used", 500)).toBeNull();
    });

    it("findValidSlackLinkTokenByHash returns null for an unknown hash", async () => {
      expect(await findValidSlackLinkTokenByHash(db, "does-not-exist", 0)).toBeNull();
    });
  });
});
