/**
 * リマインドワーカーの Node エントリポイント(BullMQ + Valkey)。
 *
 * 環境変数:
 * - REDIS_URL (既定 "redis://localhost:6379")
 * - REMINDER_INTERVAL_MINUTES (既定 15)
 * - WEBHOOK_URL (任意。テナントに tenant_notification_settings の行が1つも無い場合だけの
 *   フォールバック。DB 設定があるテナントは常に DB 設定が優先される)
 * - DATABASE_URL (既定 "file:./kizami.db"、apps/api/src/node.ts と同じ既定値)
 *
 * このファイルの責務は「BullMQ の repeatable job を定期実行し、スキャン本体(打刻忘れ
 * リマインド・36協定アラート)を呼ぶ」ことだけに限定する。スキャン本体のロジック(検知条件・
 * 重複防止・通知作成)は runReminderScan / runOvertimeAlertScan 側にあり、BullMQ/Valkey に
 * 一切依存しない(要件 §8: キュー層は差し替え可能な抽象。将来 Cloudflare Cron から直接呼ぶ
 * Workers 版エントリを追加する際、reminders.ts / overtime-alerts.ts は変更不要になる想定)。
 *
 * 2種類のスキャンは同じ repeatable job の中で順に呼ぶ(周期は共通でよい、要件上どちらも
 * 「定期スキャンで自己修復する」設計であり別ジョブに分ける必要はない)。ただし
 * 片方が例外を投げても他方のスキャンを止めないよう、それぞれ個別に try/catch する。
 *
 * 通知チャネルはテナントごとに tenant_notification_settings から組み立てる
 * (apps/api/src/lib/notification-channels.ts)。1回のジョブ実行内では同じテナントに
 * 複数ユーザーがいても DB を1回しか読まないよう、テナントIDをキーにメモ化する
 * (runReminderScan・runOvertimeAlertScan の両方で共有する)。
 */

import { Queue, Worker } from "bullmq";
import IORedis from "ioredis";
import { migrateDb } from "@kizami/db";
import type { NotificationChannel } from "@kizami/notify";
import { buildNotificationChannels } from "./lib/notification-channels.js";
import { runOvertimeAlertScan } from "./overtime-alerts.js";
import { nodemailerSendFn } from "./lib/smtp.js";
import { runReminderScan } from "./reminders.js";

const QUEUE_NAME = "kizami-reminders";
// このジョブは打刻忘れリマインドと36協定アラートの両方のスキャンを担う(周期は共通)。
const SCHEDULER_ID = "kizami-notification-scan";
const JOB_NAME = "kizami-notification-scan";

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

      // テナントごとの通知設定を1回のジョブ実行内で使い回す(同一テナントの複数ユーザーで
      // DB を何度も読まないためのメモ化)。両方のスキャンが同じキャッシュを共有する。
      const channelCache = new Map<string, Promise<NotificationChannel[]>>();
      const resolveChannels = (tenantId: string): Promise<NotificationChannel[]> => {
        let cached = channelCache.get(tenantId);
        if (!cached) {
          cached = buildNotificationChannels(db, tenantId, {
            smtpSendFn: nodemailerSendFn,
            ...(webhookUrl ? { webhookUrlFallback: webhookUrl } : {}),
          });
          channelCache.set(tenantId, cached);
        }
        return cached;
      };

      // 打刻忘れリマインドと36協定アラートは独立したスキャンとして順に走らせる。
      // 片方が例外を投げても他方の実行を妨げないよう、それぞれ個別に try/catch する
      // (要件: 「片方の失敗が他方を止めない」)。
      let reminderScanned = 0;
      let reminderCreated = 0;
      try {
        const result = await runReminderScan(db, { nowMinutes, resolveChannels });
        reminderScanned = result.scannedUserCount;
        reminderCreated = result.created.length;
        console.log(
          `[kizami-reminders] scanned ${result.scannedUserCount} active users, created ${result.created.length} notification(s)`,
        );
      } catch (err) {
        console.error("[kizami-reminders] missing-clock-out scan failed:", err);
      }

      let overtimeScanned = 0;
      let overtimeCreated = 0;
      try {
        const result = await runOvertimeAlertScan(db, { nowMinutes, resolveChannels });
        overtimeScanned = result.scannedUserCount;
        overtimeCreated = result.created.length;
        console.log(
          `[kizami-reminders] overtime-alert scan: scanned ${result.scannedUserCount} active users, created ${result.created.length} notification(s)`,
        );
      } catch (err) {
        console.error("[kizami-reminders] overtime-alert scan failed:", err);
      }

      return {
        scannedUserCount: reminderScanned,
        createdCount: reminderCreated,
        overtimeScannedUserCount: overtimeScanned,
        overtimeCreatedCount: overtimeCreated,
      };
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
    `kizami reminder worker started (interval=${reminderIntervalMinutes}min, redis=${redisUrl}, webhookFallback=${webhookUrl ? "on" : "off"})`,
  );
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
