import { beforeEach, describe, expect, it } from "vitest";
import {
  findApiKeyByHash,
  getApiKeyById,
  insertApiKey,
  listApiKeys,
  revokeApiKey,
  touchApiKeyLastUsed,
} from "../src/queries/api-keys.js";
import { migrateDb, type Database } from "../src/migrate.js";
import { tenants, users } from "../src/schema/index.js";
import { uuidv7 } from "../src/uuid.js";

describe("api_keys", () => {
  let db: Database;
  const tenantId = uuidv7();
  const userId = uuidv7();

  beforeEach(async () => {
    ({ db } = await migrateDb());
    await db.insert(tenants).values({ id: tenantId, name: "Tenant A", createdAt: 0 });
    await db.insert(users).values({ id: userId, tenantId, email: "a@example.com", name: "A", createdAt: 0 });
  });

  it("insertApiKey stores scopes as JSON and defaults last_used_at/revoked_at to null", async () => {
    const row = await insertApiKey(db, {
      tenantId,
      userId,
      name: "IC card reader",
      keyHash: "hash-1",
      scopes: ["punch"],
      expiresAt: null,
      createdBy: userId,
      createdAt: 100,
    });

    expect(row.scopes).toBe(JSON.stringify(["punch"]));
    expect(row.lastUsedAt).toBeNull();
    expect(row.revokedAt).toBeNull();
    expect(row.expiresAt).toBeNull();
    expect(row.id).toEqual(expect.any(String));
  });

  it("findApiKeyByHash returns the key when unrevoked and unexpired", async () => {
    await insertApiKey(db, {
      tenantId,
      userId,
      name: "k",
      keyHash: "hash-active",
      scopes: ["read"],
      expiresAt: 1000,
      createdBy: userId,
      createdAt: 0,
    });

    const found = await findApiKeyByHash(db, "hash-active", 999);
    expect(found).not.toBeNull();
    expect(found?.keyHash).toBe("hash-active");
  });

  it("findApiKeyByHash returns null once expired", async () => {
    await insertApiKey(db, {
      tenantId,
      userId,
      name: "k",
      keyHash: "hash-expiring",
      scopes: ["read"],
      expiresAt: 1000,
      createdBy: userId,
      createdAt: 0,
    });

    expect(await findApiKeyByHash(db, "hash-expiring", 1000)).toBeNull();
    expect(await findApiKeyByHash(db, "hash-expiring", 1001)).toBeNull();
  });

  it("findApiKeyByHash returns the key indefinitely when expiresAt is null", async () => {
    await insertApiKey(db, {
      tenantId,
      userId,
      name: "k",
      keyHash: "hash-noexpiry",
      scopes: ["read"],
      expiresAt: null,
      createdBy: userId,
      createdAt: 0,
    });

    expect(await findApiKeyByHash(db, "hash-noexpiry", 10_000_000)).not.toBeNull();
  });

  it("findApiKeyByHash returns null once revoked", async () => {
    const created = await insertApiKey(db, {
      tenantId,
      userId,
      name: "k",
      keyHash: "hash-revoked",
      scopes: ["read"],
      expiresAt: null,
      createdBy: userId,
      createdAt: 0,
    });

    expect(await findApiKeyByHash(db, "hash-revoked", 0)).not.toBeNull();
    await revokeApiKey(db, { tenantId, id: created.id, revokedAt: 50 });
    expect(await findApiKeyByHash(db, "hash-revoked", 0)).toBeNull();
  });

  it("findApiKeyByHash returns null for an unknown hash", async () => {
    expect(await findApiKeyByHash(db, "does-not-exist", 0)).toBeNull();
  });

  it("listApiKeys never includes keyHash and can be scoped to a single user", async () => {
    const otherUserId = uuidv7();
    await db.insert(users).values({ id: otherUserId, tenantId, email: "b@example.com", name: "B", createdAt: 0 });

    await insertApiKey(db, {
      tenantId,
      userId,
      name: "mine",
      keyHash: "hash-mine",
      scopes: ["punch"],
      expiresAt: null,
      createdBy: userId,
      createdAt: 10,
    });
    await insertApiKey(db, {
      tenantId,
      userId: otherUserId,
      name: "theirs",
      keyHash: "hash-theirs",
      scopes: ["read"],
      expiresAt: null,
      createdBy: otherUserId,
      createdAt: 20,
    });

    const mine = await listApiKeys(db, { tenantId, userId });
    expect(mine).toHaveLength(1);
    expect(mine[0]?.name).toBe("mine");
    expect(mine[0]).not.toHaveProperty("keyHash");

    const all = await listApiKeys(db, { tenantId });
    expect(all).toHaveLength(2);
    // 新しい順(createdAt 降順)
    expect(all.map((k) => k.name)).toEqual(["theirs", "mine"]);
  });

  it("revokeApiKey sets revoked_at and is idempotent (returns null on second call)", async () => {
    const created = await insertApiKey(db, {
      tenantId,
      userId,
      name: "k",
      keyHash: "hash-revoke-twice",
      scopes: ["punch"],
      expiresAt: null,
      createdBy: userId,
      createdAt: 0,
    });

    const first = await revokeApiKey(db, { tenantId, id: created.id, revokedAt: 500 });
    expect(first?.revokedAt).toBe(500);

    const second = await revokeApiKey(db, { tenantId, id: created.id, revokedAt: 600 });
    expect(second).toBeNull();

    const fetched = await getApiKeyById(db, { tenantId, id: created.id });
    expect(fetched?.revokedAt).toBe(500);
  });

  it("revokeApiKey scoped to tenant returns null for a mismatched tenant", async () => {
    const created = await insertApiKey(db, {
      tenantId,
      userId,
      name: "k",
      keyHash: "hash-wrong-tenant",
      scopes: ["punch"],
      expiresAt: null,
      createdBy: userId,
      createdAt: 0,
    });

    const otherTenantId = uuidv7();
    expect(await revokeApiKey(db, { tenantId: otherTenantId, id: created.id, revokedAt: 100 })).toBeNull();
  });

  it("touchApiKeyLastUsed updates last_used_at", async () => {
    const created = await insertApiKey(db, {
      tenantId,
      userId,
      name: "k",
      keyHash: "hash-touch",
      scopes: ["punch"],
      expiresAt: null,
      createdBy: userId,
      createdAt: 0,
    });
    expect(created.lastUsedAt).toBeNull();

    await touchApiKeyLastUsed(db, { id: created.id, lastUsedAt: 12345 });
    const fetched = await getApiKeyById(db, { tenantId, id: created.id });
    expect(fetched?.lastUsedAt).toBe(12345);
  });

  it("getApiKeyById returns null for an unknown id", async () => {
    expect(await getApiKeyById(db, { tenantId, id: uuidv7() })).toBeNull();
  });
});
