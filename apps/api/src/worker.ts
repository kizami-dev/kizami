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
 * - SYSTEM_SMTP_URL / SYSTEM_MAIL_FROM / APP_BASE_URL(システムメール。テナントの退会の再通知・削除の完了の
 *   メールに使う。3つ揃っていなければメールを出さず、削除だけを行う — docs/design/tenant-withdrawal.md)
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
 * 有給付与の予告・サインアップの掃除・退会テナントの処理)を呼ぶ」ことだけに限定する。
 * スキャン本体のロジック(検知条件・重複防止・通知作成)は runReminderScan /
 * runOvertimeAlertScan / runLeaveAlertScan 側にあり、BullMQ/Valkey に一切依存しない
 * (要件 §8: キュー層は差し替え可能な抽象)。1本ずつの実行(個別の try/catch・ログ・心拍・エラー報告)は
 * scheduled-jobs.ts の runScanJob にあり、Cloudflare Workers の Cron Triggers(workers-cron.ts)も
 * 同じものを呼ぶ(2026-10-07。docs/design/workers-d1.md「定期スキャン」)。
 *
 * 7種類のスキャンは同じ repeatable job の中で順に呼ぶ(周期は共通でよい、要件上いずれも
 * 「定期スキャンで自己修復する」設計であり別ジョブに分ける必要はない)。ただし
 * どれか1つが例外を投げても他のスキャンを止めない(runScanJob が投げない)。
 *
 * 通知チャネルは本人(user_notification_settings)ごとに組み立てる
 * (apps/api/src/lib/notification-channels.ts の buildPersonalChannels)。1回のジョブ実行内で
 * 同じユーザーが複数回対象になっても DB を都度読まないよう、scheduled-jobs.ts の
 * createPersonalChannelResolver がメモ化する。
 */

import { Queue, Worker } from "bullmq";
import IORedis from "ioredis";
import { migrateDb } from "@kizami/db/node";
import { buildEncryptorFromEnv } from "./lib/encryption.js";
import { buildErrorReporterFromEnv } from "./lib/error-report.js";
import { withStartupRetry } from "./lib/startup-retry.js";
import { resolveRelease } from "./lib/version.js";
import { createTenantQuotas, parseQuotaEnv } from "./lib/tenant-quotas.js";
import { buildNotifyOutboundDeps, buildOutboundGuardFromEnv } from "./lib/outbound-guard.js";
import { nodemailerSendFn } from "./lib/smtp.js";
import { parseSystemMailEnv } from "./lib/system-mail-config.js";
import { createSystemMailSender } from "./lib/system-mail.js";
import {
  createPersonalChannelResolver,
  runScanJob,
  SCAN_JOB_ORDER,
  SCAN_JOBS,
  type ScanJobContext,
  type ScanJobCounts,
  type ScanJobName,
} from "./scheduled-jobs.js";
import type { TenantWithdrawalMailer } from "./tenant-purge.js";
import { buildVapidFromEnv } from "./lib/web-push.js";

const QUEUE_NAME = "kizami-reminders";
const LOG_PREFIX = "[kizami-reminders]";
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
// アプリ側の SSRF 対策(node.ts と同じ環境変数。lib/outbound-policy.ts)。テナントの Webhook・SMTP・プッシュの
// 送り先への接続を検査済みの IP にだけ行う。既定は無効(従来どおり)。
const outboundEnv = buildOutboundGuardFromEnv(process.env);
if (outboundEnv.errors.length > 0) {
  for (const message of outboundEnv.errors) console.error(`[kizami-reminders] invalid outbound configuration: ${message}`);
  process.exit(1);
}
// テナントごとの外向きの通知の1日の上限(node.ts と同じ環境変数。lib/tenant-quotas.ts)。既定は無制限。
const quotaEnv = parseQuotaEnv(process.env);
if (quotaEnv.errors.length > 0) {
  for (const message of quotaEnv.errors) console.error(`[kizami-reminders] invalid quota configuration: ${message}`);
  process.exit(1);
}
const notifyOutboundDeps = { ...buildNotifyOutboundDeps(outboundEnv.guard, nodemailerSendFn), quotas: createTenantQuotas(quotaEnv.limits) };
// エラー報告(docs/design/observability.md)。SENTRY_DSN 未設定なら no-op。
const errorReporter = buildErrorReporterFromEnv(process.env, { release: resolveRelease(), runtime: "node" });
// テナントの退会の再通知・削除の完了のメール(docs/design/tenant-withdrawal.md)。システムメールの3つの
// 環境変数が揃っているときだけ。api(node.ts)と同じ解析を使う。値が不正なら警告だけ出してメールなしで続ける。
const systemMailEnv = parseSystemMailEnv(process.env);
for (const message of systemMailEnv.errors) console.warn(`[kizami-reminders] tenant withdrawal mail disabled: ${message}`);
const withdrawalMailer: TenantWithdrawalMailer | null =
  systemMailEnv.config !== null
    ? {
        appBaseUrl: systemMailEnv.config.appBaseUrl,
        sendMail: createSystemMailSender({ smtpUrl: systemMailEnv.config.systemSmtpUrl, from: systemMailEnv.config.systemMailFrom }),
      }
    : null;

if (!Number.isFinite(reminderIntervalMinutes) || reminderIntervalMinutes <= 0) {
  throw new Error(`REMINDER_INTERVAL_MINUTES must be a positive number, got: ${process.env.REMINDER_INTERVAL_MINUTES}`);
}

async function main(): Promise<void> {
  // BullMQ の Worker/Queue はブロッキングコマンドを使うため、リクエストのキューイングが
  // 無限に続く maxRetriesPerRequest: null が必要(ioredis の推奨設定)。
  const connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });
  // 起動直後の一時的な接続失敗は待って再試行する(lib/startup-retry.ts)。上限を超えたら投げ、
  // 下の main().catch がプロセスを終了させて k8s の再起動に任せる
  const { db } = await withStartupRetry(() => migrateDb({ url: databaseUrl }));

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

      // 7本のスキャンを従来の順に1本ずつ走らせる。1本の失敗で他を止めない・心拍とエラー報告を残す・
      // ログの文言は、すべて scheduled-jobs.ts の runScanJob が担う(Workers の Cron と共通。2026-10-07 に
      // このファイルから挙動を変えずに移した)。本人の個人チャネルは1回のジョブ実行内で使い回す
      // (createPersonalChannelResolver のメモ化。全スキャンが同じキャッシュを共有する)。
      const ctx: ScanJobContext = {
        db,
        nowMinutes,
        resolveChannels: createPersonalChannelResolver(db, { ...notifyOutboundDeps, encryptor, vapid, nowMinutes }),
        notifyDeps: { ...notifyOutboundDeps, encryptor },
        withdrawalMailer,
        errorReporter,
        logPrefix: LOG_PREFIX,
      };
      const counts = new Map<ScanJobName, ScanJobCounts>();
      for (const job of SCAN_JOB_ORDER) {
        counts.set(job, (await runScanJob(job, ctx)).counts);
      }
      const of = (job: ScanJobName): ScanJobCounts => counts.get(job) ?? {};

      return {
        scannedUserCount: of(SCAN_JOBS.reminder).scanned ?? 0,
        createdCount: of(SCAN_JOBS.reminder).created ?? 0,
        overtimeScannedUserCount: of(SCAN_JOBS.overtimeAlert).scanned ?? 0,
        overtimeCreatedCount: of(SCAN_JOBS.overtimeAlert).created ?? 0,
        leaveAlertScannedUserCount: of(SCAN_JOBS.leaveAlert).scanned ?? 0,
        leaveAlertCreatedCount: of(SCAN_JOBS.leaveAlert).created ?? 0,
        shiftVarianceScannedUserCount: of(SCAN_JOBS.shiftVarianceAlert).scanned ?? 0,
        shiftVarianceCreatedCount: of(SCAN_JOBS.shiftVarianceAlert).created ?? 0,
        shiftVarianceSelfCreatedCount: of(SCAN_JOBS.shiftVarianceAlert).createdSelf ?? 0,
        leaveGrantProposalScannedUserCount: of(SCAN_JOBS.leaveGrantProposal).scanned ?? 0,
        leaveGrantProposalCreatedCount: of(SCAN_JOBS.leaveGrantProposal).created ?? 0,
        signupCleanupDeletedCount: of(SCAN_JOBS.signupCleanup).deleted ?? 0,
        tenantWithdrawalPurgedCount: of(SCAN_JOBS.tenantWithdrawal).purged ?? 0,
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

// 起動失敗(DB 未起動でのマイグレーション失敗など)は明示的に終了する。exitCode を立てるだけだと、
// 先に開いた Redis 接続がイベントループを生かし続けてプロセスが居座り、Pod は Running のまま
// 何もしない(再起動もされない)状態になる(2026-10-04 KIZAMI Cloud 初回展開で発生)。
main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
