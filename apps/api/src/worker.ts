/**
 * リマインドワーカーの Node エントリポイント(BullMQ + Valkey)。
 *
 * 環境変数:
 * - REDIS_URL (既定 "redis://localhost:6379")
 * - REMINDER_INTERVAL_MINUTES (既定 15)
 * - DATABASE_URL (既定 "file:./kizami.db"、apps/api/src/node.ts と同じ既定値)
 *
 * 2026-08-22: 3スキャンが作る通知はすべて本人宛(打刻忘れ・36協定アラート・有給失効間近/
 * 年5日義務)であるため、通知チャネルはテナント共有 Webhook ではなく**本人の個人設定**
 * (user_notification_settings)から組み立てる(buildPersonalChannels)。以前ここにあった
 * WEBHOOK_URL 環境変数フォールバックはテナント共有チャネル専用の概念であり、個人チャネルには
 * 存在しないため廃止した(docs/requirements.md §7)。
 *
 * このファイルの責務は「BullMQ の repeatable job を定期実行し、スキャン本体(打刻忘れ
 * リマインド・36協定アラート・有給の失効間近/年5日義務アラート・シフト予実乖離・
 * 有給付与の予告)を呼ぶ」ことだけに限定する。
 * スキャン本体のロジック(検知条件・重複防止・通知作成)は runReminderScan /
 * runOvertimeAlertScan / runLeaveAlertScan 側にあり、BullMQ/Valkey に一切依存しない
 * (要件 §8: キュー層は差し替え可能な抽象。将来 Cloudflare Cron から直接呼ぶ Workers 版
 * エントリを追加する際、reminders.ts / overtime-alerts.ts / leave-alerts.ts は変更不要になる想定)。
 *
 * 3種類のスキャンは同じ repeatable job の中で順に呼ぶ(周期は共通でよい、要件上いずれも
 * 「定期スキャンで自己修復する」設計であり別ジョブに分ける必要はない)。ただし
 * どれか1つが例外を投げても他のスキャンを止めないよう、それぞれ個別に try/catch する。
 *
 * 通知チャネルは本人(user_notification_settings)ごとに組み立てる
 * (apps/api/src/lib/notification-channels.ts の buildPersonalChannels)。1回のジョブ実行内で
 * 同じユーザーが複数回(打刻忘れ・36協定の複数種別・有給の複数種別)対象になっても DB を
 * 都度読まないよう、`${tenantId}:${userId}:${category}` をキーにメモ化する(カテゴリの定義は
 * apps/api/src/lib/notification-preferences.ts に一元化。テナントの SMTP 接続情報自体は
 * buildPersonalChannels が呼ぶたびに tenant_notification_settings を読むため、テナント単位の
 * メモ化はしていない — 個人設定側と違って必須ではなく、実装の単純さを優先した判断点)。
 */

import { Queue, Worker } from "bullmq";
import IORedis from "ioredis";
import { migrateDb } from "@kizami/db";
import type { NotificationChannel } from "@kizami/notify";
import { buildEncryptorFromEnv } from "./lib/encryption.js";
import { buildPersonalChannels } from "./lib/notification-channels.js";
import { resolveNotificationCategory } from "./lib/notification-preferences.js";
import { runLeaveAlertScan } from "./leave-alerts.js";
import { runLeaveGrantProposalScan } from "./leave-grant-proposals.js";
import { runOvertimeAlertScan } from "./overtime-alerts.js";
import { nodemailerSendFn } from "./lib/smtp.js";
import { runReminderScan } from "./reminders.js";
import { runShiftVarianceAlertScan } from "./shift-variance-alerts.js";

const QUEUE_NAME = "kizami-reminders";
// このジョブは打刻忘れリマインドと36協定アラートの両方のスキャンを担う(周期は共通)。
const SCHEDULER_ID = "kizami-notification-scan";
const JOB_NAME = "kizami-notification-scan";

const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
const reminderIntervalMinutes = Number(process.env.REMINDER_INTERVAL_MINUTES ?? "15");
const databaseUrl = process.env.DATABASE_URL ?? "file:./kizami.db";
// 秘密情報(webhookUrl・smtpPassword)の復号に使う。未設定/不正なら null
// (復号できないチャネルは無効化されるだけで、スキャン自体は止めない — notification-channels.ts 参照)。
const encryptor = buildEncryptorFromEnv();

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

      // 本人の個人チャネルを1回のジョブ実行内で使い回す(同一ユーザーが同じカテゴリの
      // 通知で複数回対象になっても DB を何度も読まないためのメモ化)。3スキャンすべてが
      // 同じキャッシュを共有する。キーは `${tenantId}:${userId}:${category}`
      // (カテゴリの定義は lib/notification-preferences.ts に一元化 — 個人設定は
      // カテゴリ単位で ON/OFF するため、同カテゴリ内の複数 type は同じ結果になる)。
      const channelCache = new Map<string, Promise<NotificationChannel[]>>();
      const resolveChannels = (tenantId: string, userId: string, notificationType: string): Promise<NotificationChannel[]> => {
        const category = resolveNotificationCategory(notificationType);
        const key = `${tenantId}:${userId}:${category}`;
        let cached = channelCache.get(key);
        if (!cached) {
          cached = buildPersonalChannels(
            db,
            { tenantId, userId, notificationType },
            { smtpSendFn: nodemailerSendFn, encryptor },
          );
          channelCache.set(key, cached);
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

      let leaveAlertScanned = 0;
      let leaveAlertCreated = 0;
      try {
        const result = await runLeaveAlertScan(db, { nowMinutes, resolveChannels });
        leaveAlertScanned = result.scannedUserCount;
        leaveAlertCreated = result.created.length;
        console.log(
          `[kizami-reminders] leave-alert scan: scanned ${result.scannedUserCount} active users, created ${result.created.length} notification(s)`,
        );
      } catch (err) {
        console.error("[kizami-reminders] leave-alert scan failed:", err);
      }

      // シフト予実乖離の日次通知(docs/design/shift-work.md 決定事項4)。他の3スキャンと違い
      // 宛先は本人ではなく承認権限者+テナント共有 Webhook のみ(個人チャネル配信は次フェーズ)
      // のため、上の resolveChannels ではなく notifyDeps(テナント共有チャネルの組み立てに使う
      // smtpSendFn/encryptor)を渡す。
      let shiftVarianceScanned = 0;
      let shiftVarianceCreated = 0;
      try {
        const result = await runShiftVarianceAlertScan(db, { nowMinutes, notifyDeps: { smtpSendFn: nodemailerSendFn, encryptor } });
        shiftVarianceScanned = result.scannedUserCount;
        shiftVarianceCreated = result.created.length;
        console.log(
          `[kizami-reminders] shift-variance-alert scan: scanned ${result.scannedUserCount} active users, created ${result.created.length} notification(s)`,
        );
      } catch (err) {
        console.error("[kizami-reminders] shift-variance-alert scan failed:", err);
      }

      // 有給付与の予告(docs/requirements.md §11、v0.7 フェーズ4)。宛先はシフト予実乖離と同じく
      // 「本人ではなく管理者(leave.grant.manage 保持者)+テナント共有 Webhook」のため、
      // resolveChannels ではなく notifyDeps を渡す。
      let grantProposalScanned = 0;
      let grantProposalCreated = 0;
      try {
        const result = await runLeaveGrantProposalScan(db, { nowMinutes, notifyDeps: { smtpSendFn: nodemailerSendFn, encryptor } });
        grantProposalScanned = result.scannedUserCount;
        grantProposalCreated = result.created.length;
        console.log(
          `[kizami-reminders] leave-grant-proposal scan: scanned ${result.scannedUserCount} user(s) with hire date, created ${result.created.length} proposal(s)`,
        );
      } catch (err) {
        console.error("[kizami-reminders] leave-grant-proposal scan failed:", err);
      }

      return {
        scannedUserCount: reminderScanned,
        createdCount: reminderCreated,
        overtimeScannedUserCount: overtimeScanned,
        overtimeCreatedCount: overtimeCreated,
        leaveAlertScannedUserCount: leaveAlertScanned,
        leaveAlertCreatedCount: leaveAlertCreated,
        shiftVarianceScannedUserCount: shiftVarianceScanned,
        shiftVarianceCreatedCount: shiftVarianceCreated,
        leaveGrantProposalScannedUserCount: grantProposalScanned,
        leaveGrantProposalCreatedCount: grantProposalCreated,
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

  console.log(`kizami reminder worker started (interval=${reminderIntervalMinutes}min, redis=${redisUrl})`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
