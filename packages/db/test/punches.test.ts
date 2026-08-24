import { beforeEach, describe, expect, it } from "vitest";
import { insertPunchEvent, listValidPunches } from "../src/queries/punches.js";
import { migrateDb, type Database } from "./support/db.js";
import { tenants, users } from "../src/schema/index.js";
import { uuidv7 } from "../src/uuid.js";

describe("punch_events", () => {
  let db: Database;
  const tenantId = uuidv7();
  const userId = uuidv7();

  beforeEach(async () => {
    ({ db } = await migrateDb());
    await db.insert(tenants).values({ id: tenantId, name: "Tenant A", createdAt: 0 });
    await db.insert(users).values({ id: userId, tenantId, email: "a@example.com", name: "A", createdAt: 0 });
  });

  it("listValidPunches excludes superseded/void events and returns occurred_at ascending", async () => {
    const clockIn = await insertPunchEvent(db, {
      tenantId,
      userId,
      kind: "clock_in",
      occurredAt: 100,
      recordedAt: 100,
      source: "web",
      actorId: userId,
    });
    // 誤った退勤打刻
    const wrongClockOut = await insertPunchEvent(db, {
      tenantId,
      userId,
      kind: "clock_out",
      occurredAt: 500,
      recordedAt: 500,
      source: "web",
      actorId: userId,
    });
    // wrongClockOut を無効化する訂正
    await insertPunchEvent(db, {
      tenantId,
      userId,
      kind: "void",
      occurredAt: 500,
      recordedAt: 550,
      source: "web",
      actorId: userId,
      supersedesId: wrongClockOut.id,
    });
    // 正しい退勤打刻(意図的に挿入順序を occurredAt と逆にする)
    const correctClockOut = await insertPunchEvent(db, {
      tenantId,
      userId,
      kind: "clock_out",
      occurredAt: 600,
      recordedAt: 700,
      source: "web",
      actorId: userId,
    });

    const valid = await listValidPunches(db, { tenantId, userId, fromMinutes: 0, toMinutes: 1000 });

    expect(valid.map((p) => p.id)).toEqual([clockIn.id, correctClockOut.id]);
    expect(valid.map((p) => p.occurredAt)).toEqual([100, 600]);
  });

  it("scopes by tenant/user/time range", async () => {
    const other = await insertPunchEvent(db, {
      tenantId,
      userId,
      kind: "clock_in",
      occurredAt: 2000,
      recordedAt: 2000,
      source: "web",
      actorId: userId,
    });
    void other;

    const inRange = await insertPunchEvent(db, {
      tenantId,
      userId,
      kind: "clock_in",
      occurredAt: 100,
      recordedAt: 100,
      source: "web",
      actorId: userId,
    });

    const valid = await listValidPunches(db, { tenantId, userId, fromMinutes: 0, toMinutes: 1000 });
    expect(valid.map((p) => p.id)).toEqual([inRange.id]);
  });

  it("rejects double-superseding the same event via the supersedes_id UNIQUE index", async () => {
    const target = await insertPunchEvent(db, {
      tenantId,
      userId,
      kind: "clock_in",
      occurredAt: 100,
      recordedAt: 100,
      source: "web",
      actorId: userId,
    });

    await insertPunchEvent(db, {
      tenantId,
      userId,
      kind: "void",
      occurredAt: 100,
      recordedAt: 200,
      source: "web",
      actorId: userId,
      supersedesId: target.id,
    });

    await expect(
      insertPunchEvent(db, {
        tenantId,
        userId,
        kind: "void",
        occurredAt: 100,
        recordedAt: 300,
        source: "web",
        actorId: userId,
        supersedesId: target.id,
      }),
    ).rejects.toThrow();
  });
});
