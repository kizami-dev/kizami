import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { migrateDb, type Database } from "../src/migrate.js";
import {
  findValidSlackLinkTokenByHash,
  getSlackUserLinkBySlackUserId,
  getSlackUserLinkByUserId,
  getTenantSlackSettings,
  getTenantSlackSettingsByTeamId,
  insertSlackLinkToken,
  linkSlackUser,
  markSlackLinkTokenUsed,
  upsertTenantSlackSettings,
} from "../src/queries/slack.js";
import { slackUserLinks, tenants, users } from "../src/schema/index.js";
import { uuidv7 } from "../src/uuid.js";

describe("slack settings queries", () => {
  let db: Database;
  const tenantId = uuidv7();
  const userId = uuidv7();

  beforeEach(async () => {
    // linkSlackUser は db.transaction を使う(packages/db/src/queries/slack.ts)。
    // @libsql/client のローカル sqlite3 ドライバは db.transaction() 実行後にネイティブ接続を
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

  it("getTenantSlackSettingsByTeamId looks the tenant up by team_id", async () => {
    await upsertTenantSlackSettings(db, {
      tenantId,
      teamId: "T0000001",
      signingSecret: null,
      enabled: true,
      updatedAt: 100,
      updatedBy: userId,
    });

    const found = await getTenantSlackSettingsByTeamId(db, "T0000001");
    expect(found?.tenantId).toBe(tenantId);
    expect(await getTenantSlackSettingsByTeamId(db, "T-unknown")).toBeNull();
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
