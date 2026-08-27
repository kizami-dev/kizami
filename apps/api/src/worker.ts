/**
 * リマインドワーカーの Node エントリポイント(BullMQ + Valkey)。
 *
 * 環境変数:
 * - REDIS_URL (既定 "redis://localhost:6379")
 * - VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT(ブラウザプッシュ通知。未設定なら無効)
 * - REMINDER_INTERVAL_MINUTES (既定 15)
 * - DATABASE_URL (既定 "file:./kizami.db"、apps/api/src/node.ts と同じ既定値)
 * - SENTRY_DSN / SENTRY_SERVER_NAME / SENTRY_ENVIRONMENT(エラー報告。未設定なら no-op。
 *   docs/design/observability.md)
 *
 * 2026-08-27: 可観測性のため、スキャン1本ごとに **worker_heartbeats へ心拍を書く**
 * (最終実行時刻と成功/失敗の累計)。api の GET /metrics がこの表を読んで
 * kizami_worker_last_run_timestamp_seconds / kizami_worker_runs_total として出す。
 * ワーカー側に HTTP サーバーを立てない理由は packages/db/src/schema/worker-heartbeats.ts。
 * スキャンが例外で終わったときは同時に SENTRY_DSN 宛のエラー報告も出す(撃ちっ放し)。
 *
 * 2026-08-22: 3スキャンが作る通知はすべて本人宛(打刻忘れ・36協定アラート・有給失効間近/
 * 年5日義務。2026-08-24 にシフト予実乖離の**本人宛**通知も加わった)であるため、通知チャネルは
 * テナント共有 Webhook ではなく**本人の個人設定**(user_notification_settings)から組み立てる
 * (buildPersonalChannels)。以前ここにあった
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
import { recordWorkerHeartbeat } from "@kizami/db";
import { migrateDb } from "@kizami/db/node";
import type { NotificationChannel } from "@kizami/notify";
import { buildEncryptorFromEnv } from "./lib/encryption.js";
import { buildErrorReporterFromEnv } from "./lib/error-report.js";
import { resolveRelease } from "./lib/version.js";
import { buildPersonalChannels } from "./lib/notification-channels.js";
import { resolveNotificationCategory } from "./lib/notification-preferences.js";
import { runLeaveAlertScan } from "./leave-alerts.js";
import { runLeaveGrantProposalScan } from "./leave-grant-proposals.js";
import { runOvertimeAlertScan } from "./overtime-alerts.js";
import { nodemailerSendFn } from "./lib/smtp.js";
import { runReminderScan } from "./reminders.js";
import { runShiftVarianceAlertScan } from "./shift-variance-alerts.js";
import { buildVapidFromEnv } from "./lib/web-push.js";

const QUEUE_NAME = "kizami-reminders";

/**
 * worker_heartbeats.job_name に使う識別子(= `/metrics` の `job` ラベル)。
 * 増減させたらここと docs/design/observability.md の一覧を揃えること。
 */
const SCAN_JOBS = {
  reminder: "reminder",
  overtimeAlert: "overtime-alert",
  leaveAlert: "leave-alert",
  shiftVarianceAlert: "shift-variance-alert",
  leaveGrantProposal: "leave-grant-proposal",
} as const;
// このジョブは打刻忘れリマインドと36協定アラートの両方のスキャンを担う(周期は共通)。
const SCHEDULER_ID = "kizami-notification-scan";
const JOB_NAME = "kizami-notification-scan";

const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
const reminderIntervalMinutes = Number(process.env.REMINDER_INTERVAL_MINUTES ?? "15");
const databaseUrl = process.env.DATABASE_URL ?? "file:./kizami.db";
// 秘密情報(webhookUrl・smtpPassword)の復号に使う。未設定/不正なら null
// (復号できないチャネルは無効化されるだけで、スキャン自体は止めない — notification-channels.ts 参照)。
const encryptor = buildEncryptorFromEnv();
// ブラウザプッシュ通知の VAPID 鍵(docs/design/web-push.md)。未設定なら null =
// 個人設定で push=true でも push チャネルは組み立てられない(静かに送らない)。
const vapid = buildVapidFromEnv();
// エラー報告(docs/design/observability.md)。SENTRY_DSN 未設定なら no-op。
const errorReporter = buildErrorReporterFromEnv(process.env, { release: resolveRelease(), runtime: "node" });

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
            { smtpSendFn: nodemailerSendFn, encryptor, vapid, nowMinutes },
          );
          channelCache.set(key, cached);
        }
        return cached;
      };

      /**
       * スキャン1本の後始末(可観測性、docs/design/observability.md)。
       *
       * - 心拍を worker_heartbeats に書く(成功/失敗の累計は単調増加)。api の GET /metrics が読む
       * - 失敗していればエラー報告(SENTRY_DSN 未設定なら no-op)。文脈はスキャン名だけを渡す
       *   — 対象ユーザーやテナントは載せない(プライバシー: lib/error-report.ts 冒頭)
       *
       * 心拍の書き込み自体が失敗してもスキャンの成否には影響させない(観測のための書き込みで
       * 業務処理を落とさない)。
       */
      const finishScan = async (jobName: string, err?: unknown): Promise<void> => {
        if (err !== undefined) errorReporter.capture(err, { job: jobName });
        try {
          await recordWorkerHeartbeat(db, { jobName, nowMinutes, ok: err === undefined });
        } catch (heartbeatErr) {
          console.error(`[kizami-reminders] ${jobName} の心拍を記録できませんでした:`, heartbeatErr);
        }
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
        await finishScan(SCAN_JOBS.reminder);
      } catch (err) {
        console.error("[kizami-reminders] missing-clock-out scan failed:", err);
        await finishScan(SCAN_JOBS.reminder, err);
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
        await finishScan(SCAN_JOBS.overtimeAlert);
      } catch (err) {
        console.error("[kizami-reminders] overtime-alert scan failed:", err);
        await finishScan(SCAN_JOBS.overtimeAlert, err);
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
        await finishScan(SCAN_JOBS.leaveAlert);
      } catch (err) {
        console.error("[kizami-reminders] leave-alert scan failed:", err);
        await finishScan(SCAN_JOBS.leaveAlert, err);
      }

      // シフト予実乖離の日次通知(docs/design/shift-work.md 決定事項4)。このスキャンだけは
      // 宛先が2系統あるため両方の依存を渡す: 管理者向け日次ダイジェストはテナント共有チャネル
      // (notifyDeps)、本人向け通知(2026-08-24 追加)は他の3スキャンと同じ個人チャネル
      // (resolveChannels = buildPersonalChannels)。
      let shiftVarianceScanned = 0;
      let shiftVarianceCreated = 0;
      let shiftVarianceSelfCreated = 0;
      try {
        const result = await runShiftVarianceAlertScan(db, {
          nowMinutes,
          notifyDeps: { smtpSendFn: nodemailerSendFn, encryptor },
          resolveChannels,
        });
        shiftVarianceScanned = result.scannedUserCount;
        shiftVarianceCreated = result.created.length;
        shiftVarianceSelfCreated = result.createdSelf.length;
        console.log(
          `[kizami-reminders] shift-variance-alert scan: scanned ${result.scannedUserCount} active users, created ${result.created.length} manager notification(s) and ${result.createdSelf.length} personal notification(s)`,
        );
        await finishScan(SCAN_JOBS.shiftVarianceAlert);
      } catch (err) {
        console.error("[kizami-reminders] shift-variance-alert scan failed:", err);
        await finishScan(SCAN_JOBS.shiftVarianceAlert, err);
      }

      // 有給付与の予告(docs/requirements.md §11、v0.7 フェーズ4)。宛先は「本人ではなく管理者
      // (leave.grant.manage 保持者)+テナント共有 Webhook」だけなので(シフト予実乖離と違い
      // 本人宛の系統を持たない)、resolveChannels ではなく notifyDeps のみを渡す。
      let grantProposalScanned = 0;
      let grantProposalCreated = 0;
      try {
        const result = await runLeaveGrantProposalScan(db, { nowMinutes, notifyDeps: { smtpSendFn: nodemailerSendFn, encryptor } });
        grantProposalScanned = result.scannedUserCount;
        grantProposalCreated = result.created.length;
        console.log(
          `[kizami-reminders] leave-grant-proposal scan: scanned ${result.scannedUserCount} user(s) with hire date, created ${result.created.length} proposal(s)`,
        );
        await finishScan(SCAN_JOBS.leaveGrantProposal);
      } catch (err) {
        console.error("[kizami-reminders] leave-grant-proposal scan failed:", err);
        await finishScan(SCAN_JOBS.leaveGrantProposal, err);
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
        shiftVarianceSelfCreatedCount: shiftVarianceSelfCreated,
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
