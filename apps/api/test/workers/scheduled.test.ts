/**
 * Cron Triggers(`scheduled()`)が **workerd + D1** で定期スキャンを走らせることの確認
 * (docs/design/workers-d1.md「定期スキャン」、src/workers-cron.ts)。
 *
 * 叩いているのは配備するのと同じ src/workers.ts の default export の `scheduled()`。cron 式ごとに起動して、
 * 対応するスキャンだけが走ったこと(worker_heartbeats の心拍)と、スキャンが D1 に通知の行を作ること、
 * 退会テナントの物理削除が D1(`BEGIN` を拒否する)でも完了することを見る。スキャンの中身の網羅は
 * Node レグ(reminders.test.ts など)が持つ。
 *
 * 時刻は `scheduledTime` で固定する(スキャンの「今」は予定時刻 — src/workers-cron.ts「冪等と再試行」)。
 * workerd は偽タイマーと相性が悪い(smoke.test.ts 冒頭)が、ここは壁時計を使わないので固定できる。
 */

import { applyD1Migrations, createExecutionContext, createScheduledController, env, waitOnExecutionContext } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  createD1Database,
  insertPunchEvent,
  listNotifications,
  listWorkerHeartbeats,
  tenantPurgeRecords,
  tenants,
  uuidv7,
  type Database,
} from "@kizami/db";
import worker from "../../src/workers.js";
import { WORKERS_CRON_SCHEDULE } from "../../src/workers-cron.js";
import { jstMinutes, seedTenant } from "../support/seed.js";

// JST 2026-04-15 12:00(reminders.test.ts と同じ固定時刻)
const SCHEDULED_TIME = Date.UTC(2026, 3, 15, 3, 0);
const NOW_MINUTES = Math.floor(SCHEDULED_TIME / 60_000);

const REMINDER_CRON = "0,15,30,45 * * * *";
const WITHDRAWAL_CRON = "6,21,36,51 * * * *";

let db: Database;
let tenantId: string;
let userId: string;
let withdrawnTenantId: string;

async function runCron(cron: string, scheduledTime = SCHEDULED_TIME): Promise<void> {
  const controller = createScheduledController({ cron, scheduledTime });
  const ctx = createExecutionContext();
  await worker.scheduled(controller, env as never, ctx);
  await waitOnExecutionContext(ctx);
}

async function heartbeat(jobName: string) {
  return (await listWorkerHeartbeats(db)).find((row) => row.jobName === jobName);
}

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
  ({ db } = createD1Database(env.DB));
  ({ tenantId, userId } = await seedTenant(db));

  // 打刻忘れ: 4/1 に出勤だけ打ってある(4/15 の時点で日界を過ぎている)
  const clockInAt = jstMinutes(2026, 4, 1, 9, 0);
  await insertPunchEvent(db, { tenantId, userId, kind: "clock_in", occurredAt: clockInAt, recordedAt: clockInAt, source: "web", actorId: userId });

  // 退会: 削除予定の時刻を過ぎたテナント(行はテナントだけ。削除の本体は D1 の 1文ずつのモード)
  withdrawnTenantId = uuidv7();
  await db.insert(tenants).values({
    id: withdrawnTenantId,
    name: "Withdrawn Tenant",
    createdAt: 0,
    withdrawalRequestedAt: NOW_MINUTES - 31 * 24 * 60,
    withdrawalScheduledPurgeAt: NOW_MINUTES - 60,
    withdrawalReminderSentAt: NOW_MINUTES - 8 * 24 * 60,
  });
});

describe("scheduled() on workerd + D1", () => {
  it("cron 式ごとに、対応するスキャンだけが走って心拍が残る", async () => {
    for (const [cron, jobs] of Object.entries(WORKERS_CRON_SCHEDULE)) {
      const before = new Map((await listWorkerHeartbeats(db)).map((row) => [row.jobName, row.successCount + row.failureCount]));
      await runCron(cron);
      const after = await listWorkerHeartbeats(db);
      const ran = after.filter((row) => row.successCount + row.failureCount > (before.get(row.jobName) ?? 0)).map((row) => row.jobName);
      expect(ran.sort()).toEqual([...jobs].sort());
      for (const job of jobs) {
        expect(await heartbeat(job)).toMatchObject({ lastRunAt: NOW_MINUTES, lastResult: "success" });
      }
    }
  });

  it("打刻忘れのスキャンが D1 に通知を作り、同じ予定時刻の再起動では増えない", async () => {
    const notifications = await listNotifications(db, { tenantId, userId });
    expect(notifications.filter((n) => n.type === "missing_clock_out").map((n) => n.subjectDate)).toEqual(["2026-04-01"]);

    // Cron の再試行・二重起動(同じ scheduledTime)
    await runCron(REMINDER_CRON);
    await runCron(REMINDER_CRON);
    expect((await listNotifications(db, { tenantId, userId })).filter((n) => n.type === "missing_clock_out")).toHaveLength(1);
  });

  it("削除予定を過ぎた退会テナントを D1 でも物理削除し終える(transactional: false)", async () => {
    // 最初の it で WITHDRAWAL_CRON は既に1回走っている。もう一度走らせても冪等
    await runCron(WITHDRAWAL_CRON);
    expect(await db.select().from(tenants).where(eq(tenants.id, withdrawnTenantId))).toEqual([]);
    const [record] = await db.select().from(tenantPurgeRecords).where(eq(tenantPurgeRecords.tenantId, withdrawnTenantId));
    expect(record?.purgedAt).not.toBeNull();
    expect(await heartbeat("tenant-withdrawal")).toMatchObject({ lastResult: "success" });
    // 退会していないテナントは残っている
    expect(await db.select().from(tenants).where(eq(tenants.id, tenantId))).toHaveLength(1);
  });

  it("対応表に無い cron 式では何も走らせず、失敗として投げる", async () => {
    const before = await listWorkerHeartbeats(db);
    await expect(runCron("*/5 * * * *")).rejects.toThrow(/no scan is mapped/);
    expect(await listWorkerHeartbeats(db)).toEqual(before);
  });
});
