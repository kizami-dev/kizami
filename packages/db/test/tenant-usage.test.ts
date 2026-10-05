/**
 * テナントごとの利用上限(src/queries/tenant-usage.ts)。設計は docs/design/tenant-quotas.md。
 */

import { beforeEach, describe, expect, it } from "vitest";
import { migrateDb, type Database } from "./support/db.js";
import {
  consumeTenantDailyCounter,
  countActiveApiKeys,
  countActiveMembers,
  deleteTenantUsageCounters,
  getTenantDailyCounter,
  incrementTenantCounter,
  sumQuotaLimitHits,
  usageDayFromMinutes,
} from "../src/queries/tenant-usage.js";
import { apiKeys, tenants, users } from "../src/schema/index.js";
import { uuidv7 } from "../src/uuid.js";

describe("usageDayFromMinutes", () => {
  it("日本時間の 0 時(UTC 15:00)で日が切り替わる", () => {
    // 2026-10-05 14:59 UTC = 23:59 JST と、15:00 UTC = 翌 00:00 JST
    const before = Date.UTC(2026, 9, 5, 14, 59) / 60_000;
    const after = Date.UTC(2026, 9, 5, 15, 0) / 60_000;
    expect(usageDayFromMinutes(after)).toBe(usageDayFromMinutes(before) + 1);
  });
});

describe("consumeTenantDailyCounter", () => {
  let db: Database;
  const tenantA = uuidv7();
  const tenantB = uuidv7();

  beforeEach(async () => {
    ({ db } = await migrateDb());
  });

  it("上限までは +1 でき、上限に達したあとは書き込まずに断る(カウンタは上限のまま)", async () => {
    const params = { tenantId: tenantA, counterKey: "outbound_notifications", day: 100, limit: 3 };
    expect(await consumeTenantDailyCounter(db, params)).toEqual({ allowed: true, count: 1 });
    expect(await consumeTenantDailyCounter(db, params)).toEqual({ allowed: true, count: 2 });
    expect(await consumeTenantDailyCounter(db, params)).toEqual({ allowed: true, count: 3 });
    expect(await consumeTenantDailyCounter(db, params)).toEqual({ allowed: false, count: 0 });
    expect(await consumeTenantDailyCounter(db, params)).toEqual({ allowed: false, count: 0 });
    expect(await getTenantDailyCounter(db, params)).toBe(3);
  });

  it("上限 0 は最初から断る(行も作らない)", async () => {
    const params = { tenantId: tenantA, counterKey: "outbound_notifications", day: 100, limit: 0 };
    expect(await consumeTenantDailyCounter(db, params)).toEqual({ allowed: false, count: 0 });
    expect(await getTenantDailyCounter(db, params)).toBe(0);
  });

  it("テナント・種別・日ごとに独立している", async () => {
    const base = { counterKey: "outbound_notifications", day: 100, limit: 1 };
    expect((await consumeTenantDailyCounter(db, { ...base, tenantId: tenantA })).allowed).toBe(true);
    expect((await consumeTenantDailyCounter(db, { ...base, tenantId: tenantA })).allowed).toBe(false);
    // 別テナント・別の種別・翌日は、それぞれ別に数える
    expect((await consumeTenantDailyCounter(db, { ...base, tenantId: tenantB })).allowed).toBe(true);
    expect((await consumeTenantDailyCounter(db, { ...base, tenantId: tenantA, counterKey: "invite_reset_mails" })).allowed).toBe(true);
    expect((await consumeTenantDailyCounter(db, { ...base, tenantId: tenantA, day: 101 })).allowed).toBe(true);
  });

  it("同時に呼んでも上限を超えて通らない", async () => {
    const params = { tenantId: tenantA, counterKey: "outbound_notifications", day: 100, limit: 5 };
    const results = await Promise.all(Array.from({ length: 20 }, () => consumeTenantDailyCounter(db, params)));
    expect(results.filter((r) => r.allowed)).toHaveLength(5);
    expect(await getTenantDailyCounter(db, params)).toBe(5);
  });
});

describe("hit の記録と集計", () => {
  let db: Database;
  beforeEach(async () => {
    ({ db } = await migrateDb());
  });

  it("incrementTenantCounter は +1 後の値を返し、sumQuotaLimitHits は hit: の種別だけをテナント横断で合算する", async () => {
    expect(await incrementTenantCounter(db, { tenantId: "t1", counterKey: "hit:members", day: 1 })).toBe(1);
    expect(await incrementTenantCounter(db, { tenantId: "t1", counterKey: "hit:members", day: 1 })).toBe(2);
    await incrementTenantCounter(db, { tenantId: "t1", counterKey: "hit:members", day: 2 });
    await incrementTenantCounter(db, { tenantId: "t2", counterKey: "hit:members", day: 1 });
    await incrementTenantCounter(db, { tenantId: "t2", counterKey: "hit:api_keys", day: 1 });
    // hit 以外のカウンタは含めない
    await consumeTenantDailyCounter(db, { tenantId: "t1", counterKey: "outbound_notifications", day: 1, limit: 10 });

    expect(await sumQuotaLimitHits(db)).toEqual({ members: 4, api_keys: 1 });
  });

  it("deleteTenantUsageCounters はそのテナントの行だけを消す", async () => {
    await incrementTenantCounter(db, { tenantId: "t1", counterKey: "hit:members", day: 1 });
    await incrementTenantCounter(db, { tenantId: "t2", counterKey: "hit:members", day: 1 });
    await deleteTenantUsageCounters(db, "t1");
    expect(await sumQuotaLimitHits(db)).toEqual({ members: 1 });
  });
});

describe("countActiveMembers / countActiveApiKeys", () => {
  let db: Database;
  const tenantId = uuidv7();
  const otherTenantId = uuidv7();

  beforeEach(async () => {
    ({ db } = await migrateDb());
    await db.insert(tenants).values([
      { id: tenantId, name: "A", createdAt: 0 },
      { id: otherTenantId, name: "B", createdAt: 0 },
    ]);
  });

  it("在籍者だけを数える(退職処理済み・消去済み・他テナントは数えない)", async () => {
    const mk = (over: Partial<typeof users.$inferInsert>) => ({
      id: uuidv7(),
      tenantId,
      email: `${uuidv7()}@example.com`,
      name: "x",
      isActive: true,
      createdAt: 0,
      ...over,
    });
    await db.insert(users).values([
      mk({}),
      mk({}),
      mk({ isActive: false }),
      mk({ erasedAt: 5 }),
      mk({ tenantId: otherTenantId }),
    ]);
    expect(await countActiveMembers(db, tenantId)).toBe(2);
  });

  it("有効な API キーだけを数える(失効・期限切れ・他テナントは数えない)", async () => {
    const userId = uuidv7();
    await db.insert(users).values({ id: userId, tenantId, email: "u@example.com", name: "u", isActive: true, createdAt: 0 });
    const mk = (over: Partial<typeof apiKeys.$inferInsert>) => ({
      id: uuidv7(),
      tenantId,
      userId,
      name: "k",
      keyHash: uuidv7(),
      scopes: "[]",
      expiresAt: null,
      createdBy: userId,
      createdAt: 0,
      ...over,
    });
    await db.insert(apiKeys).values([
      mk({}),
      mk({ expiresAt: 1000 }),
      mk({ expiresAt: 10 }),
      mk({ revokedAt: 5 }),
    ]);
    expect(await countActiveApiKeys(db, { tenantId, nowMinutes: 100 })).toBe(2);
    expect(await countActiveApiKeys(db, { tenantId: otherTenantId, nowMinutes: 100 })).toBe(0);
  });
});
