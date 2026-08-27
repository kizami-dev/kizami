/**
 * `/metrics` が使うクエリ(src/queries/observability.ts)。
 * 設計は docs/design/observability.md。
 */

import { beforeEach, describe, expect, it } from "vitest";
import { migrateDb, type Database } from "./support/db.js";
import { countObservabilityGauges, listWorkerHeartbeats, recordWorkerHeartbeat } from "../src/queries/observability.js";
import { punchEvents, tenants, users } from "../src/schema/index.js";
import { uuidv7 } from "../src/uuid.js";

/** テストの現在時刻(UTC エポック分)。実時刻に依存させない。 */
const NOW_MINUTES = 30_000_000;

describe("countObservabilityGauges", () => {
  let db: Database;
  const tenantId = uuidv7();
  const userId = uuidv7();

  beforeEach(async () => {
    ({ db } = await migrateDb());
    await db.insert(tenants).values({ id: tenantId, name: "Tenant A", createdAt: 0 });
    await db.insert(users).values({ id: userId, tenantId, email: "a@example.com", name: "A", isActive: true, createdAt: 0 });
  });

  it("空の DB では 0 を返す(punch が1件も無い状態)", async () => {
    const counts = await countObservabilityGauges(db, NOW_MINUTES);
    expect(counts).toEqual({ users: 1, tenants: 1, punchesLast24h: 0 });
  });

  it("直近24時間の打刻だけを数える(境界は 24h ちょうどを含む)", async () => {
    const insertPunch = async (occurredAt: number): Promise<void> => {
      await db.insert(punchEvents).values({
        id: uuidv7(),
        tenantId,
        userId,
        kind: "clock_in",
        occurredAt,
        recordedAt: occurredAt,
        source: "web",
        actorId: userId,
      });
    };

    await insertPunch(NOW_MINUTES); // 今
    await insertPunch(NOW_MINUTES - 1); // 1分前
    await insertPunch(NOW_MINUTES - 24 * 60); // ちょうど24時間前(含む)
    await insertPunch(NOW_MINUTES - 24 * 60 - 1); // 24時間+1分前(含まない)

    const counts = await countObservabilityGauges(db, NOW_MINUTES);
    expect(counts.punchesLast24h).toBe(3);
  });

  it("無効化されたユーザーも users に数える(抱えている人数を見るため)", async () => {
    await db.insert(users).values({
      id: uuidv7(),
      tenantId,
      email: "b@example.com",
      name: "B",
      isActive: false,
      createdAt: 0,
    });
    expect((await countObservabilityGauges(db, NOW_MINUTES)).users).toBe(2);
  });
});

describe("recordWorkerHeartbeat", () => {
  let db: Database;

  beforeEach(async () => {
    ({ db } = await migrateDb());
  });

  it("初回は行を作り、以降は同じ行を更新する", async () => {
    await recordWorkerHeartbeat(db, { jobName: "reminder", nowMinutes: NOW_MINUTES, ok: true });
    expect(await listWorkerHeartbeats(db)).toEqual([
      { jobName: "reminder", lastRunAt: NOW_MINUTES, lastResult: "success", successCount: 1, failureCount: 0 },
    ]);

    await recordWorkerHeartbeat(db, { jobName: "reminder", nowMinutes: NOW_MINUTES + 15, ok: false });
    expect(await listWorkerHeartbeats(db)).toEqual([
      { jobName: "reminder", lastRunAt: NOW_MINUTES + 15, lastResult: "failure", successCount: 1, failureCount: 1 },
    ]);
  });

  it("成功/失敗の累計は単調増加する(Prometheus の counter 規約)", async () => {
    for (let i = 0; i < 5; i += 1) {
      await recordWorkerHeartbeat(db, { jobName: "leave-alert", nowMinutes: NOW_MINUTES + i, ok: i % 2 === 0 });
    }
    const [row] = await listWorkerHeartbeats(db);
    expect(row).toMatchObject({ successCount: 3, failureCount: 2, lastResult: "success" });
  });

  it("ジョブごとに独立した行を持つ", async () => {
    await recordWorkerHeartbeat(db, { jobName: "reminder", nowMinutes: NOW_MINUTES, ok: true });
    await recordWorkerHeartbeat(db, { jobName: "overtime-alert", nowMinutes: NOW_MINUTES, ok: false });
    const rows = await listWorkerHeartbeats(db);
    expect(rows.map((row) => row.jobName).sort()).toEqual(["overtime-alert", "reminder"]);
  });
});
