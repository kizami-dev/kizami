/**
 * リマインドワーカーの Node エントリポイント(BullMQ + Valkey)。
 *
 * 環境変数:
 * - REDIS_URL (既定 "redis://localhost:6379")
 * - REMINDER_INTERVAL_MINUTES (既定 15)
 * - WEBHOOK_URL (任意。設定されていれば新規通知を Slack/Discord 互換 Webhook にも送る)
 * - DATABASE_URL (既定 "file:./kizami.db"、apps/api/src/node.ts と同じ既定値)
 *
 * このファイルの責務は「BullMQ の repeatable job を定期実行し、src/reminders.ts の
 * runReminderScan を呼ぶ」ことだけに限定する。スキャン本体のロジック(検知条件・重複防止・
 * 通知作成)は runReminderScan 側にあり、BullMQ/Valkey に一切依存しない
 * (要件 §8: キュー層は差し替え可能な抽象。将来 Cloudflare Cron から runReminderScan を
 * 直接呼ぶ Workers 版エントリを追加する際、reminders.ts は変更不要になる想定)。
 */

import { Queue, Worker } from "bullmq";
import IORedis from "ioredis";
import { migrateDb } from "@kizami/db";
import { webhookChannel, type NotificationChannel } from "@kizami/notify";
import { runReminderScan } from "./reminders.js";

const QUEUE_NAME = "kizami-reminders";
const SCHEDULER_ID = "missing-clock-out-scan";
const JOB_NAME = "missing-clock-out-scan";

const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
const reminderIntervalMinutes = Number(process.env.REMINDER_INTERVAL_MINUTES ?? "15");
const webhookUrl = process.env.WEBHOOK_URL;
const databaseUrl = process.env.DATABASE_URL ?? "file:./kizami.db";

if (!Number.isFinite(reminderIntervalMinutes) || reminderIntervalMinutes <= 0) {
  throw new Error(`REMINDER_INTERVAL_MINUTES must be a positive number, got: ${process.env.REMINDER_INTERVAL_MINUTES}`);
}

async function main(): Promise<void> {
  // BullMQ の Worker/Queue はブロッキングコマンドを使うため、リクエストのキューイングが
  // 無限に続く maxRetriesPerRequest: null が必要(ioredis の推奨設定)。
  const connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });
  const { db } = await migrateDb({ url: databaseUrl });

  const channels: NotificationChannel[] = webhookUrl ? [webhookChannel(webhookUrl)] : [];

  const queue = new Queue(QUEUE_NAME, { connection });
  await queue.upsertJobScheduler(
    SCHEDULER_ID,
    { every: reminderIntervalMinutes * 60_000 },
    { name: JOB_NAME, data: {} },
  );

  const worker = new Worker(
    QUEUE_NAME,
    async () => {
      const nowMinutes = Math.floor(Date.now() / 60_000);
      const result = await runReminderScan(db, { nowMinutes, channels });
      console.log(
        `[kizami-reminders] scanned ${result.scannedUserCount} active users, created ${result.created.length} notification(s)`,
      );
      return { scannedUserCount: result.scannedUserCount, createdCount: result.created.length };
    },
    { connection },
  );

  worker.on("failed", (job, err) => {
    console.error(`[kizami-reminders] job ${job?.id ?? "?"} failed:`, err);
  });

  const shutdown = async (): Promise<void> => {
    await worker.close();
    await queue.close();
    connection.disconnect();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown());
  process.on("SIGINT", () => void shutdown());

  console.log(
    `kizami reminder worker started (interval=${reminderIntervalMinutes}min, redis=${redisUrl}, webhook=${webhookUrl ? "on" : "off"})`,
  );
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
