/**
 * 定期スキャンの「1本ぶんの実行」(ランタイム非依存、2026-10-07、docs/design/workers-d1.md「定期スキャン」)。
 *
 * Node のワーカー(src/worker.ts、BullMQ + Valkey)と Workers の Cron Triggers(src/workers-cron.ts)の
 * **両方がここを通る**。以前は worker.ts の BullMQ のジョブの中に7本ぶんの try/catch・ログ・心拍が
 * 直書きされていたが、Workers からも同じ順序・同じ失敗の扱いで呼ぶために、挙動を変えずにここへ移した
 * (ログの文言も従来どおり。運用者のログ検索を壊さないため)。
 *
 * ## 1本ごとの約束
 *
 * - **失敗を外へ漏らさない**: スキャンが例外を投げても `runScanJob` は投げない。1本の失敗で同じ回の
 *   他のスキャンを止めない(worker.ts の従来の要件「片方の失敗が他方を止めない」)
 * - 終わったら**心拍を worker_heartbeats に書く**(成功/失敗の累計。api の GET /metrics が読む)。
 *   失敗ならエラー報告(SENTRY_DSN 未設定なら no-op)。心拍の書き込みの失敗はスキャンの成否に影響させない
 * - **冪等**: 同じ `nowMinutes` で2回走っても結果は同じ(Cron の再試行・二重起動に備える)。各スキャンの
 *   重複防止は次のとおりで、ここでは何も足していない:
 *   - 通知は notifications の UNIQUE(tenant_id, user_id, type, subject_date)+ `createNotificationIfAbsent`。
 *     外部チャネル(メール・Webhook・プッシュ)へは「新規に作れた通知」だけを送る
 *   - 有給付与の予告の行は「有効な予告が既にあれば作らない」の確認のあとに作る(DB の UNIQUE は無い)。
 *     **順に**走る再試行では重複しないが、同じジョブが**同時に**2本走ると重複しうる(残る注意。
 *     workers-d1.md「今後の課題」)
 *   - サインアップ・再設定の掃除は「期限を過ぎた行の削除」なので何度でも同じ
 *   - 退会の再通知は条件付き UPDATE の印(`markWithdrawalReminderSent`)を先に取ってから送るので1通だけ。
 *     物理削除は「削除中」の印 + テーブルごとの削除で、途中からの再実行で続きを完了する(@kizami/db の purgeTenant)
 *
 * このファイルは BullMQ・Valkey・node:* のいずれにも依存しない(Workers のバンドルに入る)。
 */

import { recordWorkerHeartbeat, type Database } from "@kizami/db";
import type { NotificationChannel } from "@kizami/notify";
import type { ErrorReporter } from "./lib/error-report.js";
import { buildPersonalChannels, type BuildNotificationChannelsOptions, type BuildPersonalChannelsOptions } from "./lib/notification-channels.js";
import { resolveNotificationCategory } from "./lib/notification-preferences.js";
import { runLeaveAlertScan } from "./leave-alerts.js";
import { runLeaveGrantProposalScan } from "./leave-grant-proposals.js";
import { runOvertimeAlertScan } from "./overtime-alerts.js";
import { runReminderScan } from "./reminders.js";
import { runShiftVarianceAlertScan } from "./shift-variance-alerts.js";
import { runPasswordResetRequestCleanup, runPendingSignupCleanup } from "./signup-cleanup.js";
import { runTenantWithdrawalScan, type TenantWithdrawalMailer } from "./tenant-purge.js";

/**
 * worker_heartbeats.job_name に使う識別子(= `/metrics` の `job` ラベル)。
 * 増減させたらここと docs/design/observability.md の一覧、src/workers-cron.ts の対応表を揃えること
 * (対応表の漏れは test/scheduled-jobs.test.ts が落とす)。
 */
export const SCAN_JOBS = {
  reminder: "reminder",
  overtimeAlert: "overtime-alert",
  leaveAlert: "leave-alert",
  shiftVarianceAlert: "shift-variance-alert",
  leaveGrantProposal: "leave-grant-proposal",
  signupCleanup: "signup-cleanup",
  tenantWithdrawal: "tenant-withdrawal",
} as const;

export type ScanJobName = (typeof SCAN_JOBS)[keyof typeof SCAN_JOBS];

/** Node のワーカーが1回のジョブで走らせる順(従来の worker.ts の順)。 */
export const SCAN_JOB_ORDER: readonly ScanJobName[] = [
  SCAN_JOBS.reminder,
  SCAN_JOBS.overtimeAlert,
  SCAN_JOBS.leaveAlert,
  SCAN_JOBS.shiftVarianceAlert,
  SCAN_JOBS.leaveGrantProposal,
  SCAN_JOBS.signupCleanup,
  SCAN_JOBS.tenantWithdrawal,
];

/** 本人宛の通知のチャネルを返す(スキャンが渡す `resolveChannels`)。 */
export type ResolveChannels = (tenantId: string, userId: string, notificationType: string) => Promise<NotificationChannel[]>;

/**
 * 本人の個人チャネルを1回の実行の中で使い回す resolver を作る。
 *
 * 同一ユーザーが同じカテゴリの通知で複数回対象になっても DB を何度も読まないためのメモ化。キーは
 * `${tenantId}:${userId}:${category}`(カテゴリの定義は lib/notification-preferences.ts に一元化 — 個人設定は
 * カテゴリ単位で ON/OFF するため、同カテゴリ内の複数 type は同じ結果になる)。テナントの SMTP 接続情報は
 * buildPersonalChannels が呼ぶたびに読む(テナント単位のメモ化はしない — 実装の単純さを優先した判断点)。
 */
export function createPersonalChannelResolver(db: Database, options: BuildPersonalChannelsOptions): ResolveChannels {
  const cache = new Map<string, Promise<NotificationChannel[]>>();
  return (tenantId, userId, notificationType) => {
    const category = resolveNotificationCategory(notificationType);
    const key = `${tenantId}:${userId}:${category}`;
    let cached = cache.get(key);
    if (!cached) {
      cached = buildPersonalChannels(db, { tenantId, userId, notificationType }, options);
      cache.set(key, cached);
    }
    return cached;
  };
}

/** 1回の実行に共通の依存。 */
export interface ScanJobContext {
  db: Database;
  /** この回の「今」(UTC エポック分)。Node は実時刻、Workers は Cron の予定時刻 */
  nowMinutes: number;
  /** 本人宛の通知のチャネル(createPersonalChannelResolver) */
  resolveChannels: ResolveChannels;
  /** テナント共有チャネルの依存(シフト予実乖離の管理者向け・有給付与の予告) */
  notifyDeps: BuildNotificationChannelsOptions;
  /** 退会のメールの送り先(システムメールが無い配備は null = メールなしで削除だけ) */
  withdrawalMailer: TenantWithdrawalMailer | null;
  /**
   * 退会テナントの物理削除を1トランザクションで行うか。省略 = 既定(true)。**D1 では false**
   * (`BEGIN` を拒否されるため。テーブルごとに1文ずつ冪等に消す — @kizami/db の purgeTenant)
   */
  purgeTransactional?: boolean;
  errorReporter: ErrorReporter;
  /** ログの接頭辞(Node のワーカーは従来どおり "[kizami-reminders]") */
  logPrefix: string;
}

/** スキャン1本の件数(worker.ts の BullMQ のジョブの戻り値と、Workers のログに使う)。失敗した本は途中までの値。 */
export interface ScanJobCounts {
  scanned?: number;
  created?: number;
  createdSelf?: number;
  deleted?: number;
  reminded?: number;
  purged?: number;
}

export interface ScanJobOutcome {
  job: ScanJobName;
  ok: boolean;
  counts: ScanJobCounts;
  /** 失敗の原因(ok=false のときだけ) */
  error?: unknown;
}

/** 1本ぶんの本体。件数は `counts` に書きながら進める(途中で投げても、そこまでの件数は残る)。失敗は例外か戻り値。 */
type ScanJobBody = (ctx: ScanJobContext, counts: ScanJobCounts) => Promise<{ error?: unknown } | void>;

const JOB_BODIES: Record<ScanJobName, ScanJobBody> = {
  [SCAN_JOBS.reminder]: async ({ db, nowMinutes, resolveChannels, logPrefix }, counts) => {
    const result = await runReminderScan(db, { nowMinutes, resolveChannels });
    counts.scanned = result.scannedUserCount;
    counts.created = result.created.length;
    console.log(`${logPrefix} scanned ${result.scannedUserCount} active users, created ${result.created.length} notification(s)`);
  },

  [SCAN_JOBS.overtimeAlert]: async ({ db, nowMinutes, resolveChannels, logPrefix }, counts) => {
    const result = await runOvertimeAlertScan(db, { nowMinutes, resolveChannels });
    counts.scanned = result.scannedUserCount;
    counts.created = result.created.length;
    console.log(
      `${logPrefix} overtime-alert scan: scanned ${result.scannedUserCount} active users, created ${result.created.length} notification(s)`,
    );
  },

  [SCAN_JOBS.leaveAlert]: async ({ db, nowMinutes, resolveChannels, logPrefix }, counts) => {
    const result = await runLeaveAlertScan(db, { nowMinutes, resolveChannels });
    counts.scanned = result.scannedUserCount;
    counts.created = result.created.length;
    console.log(
      `${logPrefix} leave-alert scan: scanned ${result.scannedUserCount} active users, created ${result.created.length} notification(s)`,
    );
  },

  // シフト予実乖離の日次通知(docs/design/shift-work.md 決定事項4)。このスキャンだけは宛先が2系統あるため
  // 両方の依存を渡す: 管理者向け日次ダイジェストはテナント共有チャネル(notifyDeps)、本人向け通知
  // (2026-08-24 追加)は他の3スキャンと同じ個人チャネル(resolveChannels = buildPersonalChannels)。
  [SCAN_JOBS.shiftVarianceAlert]: async ({ db, nowMinutes, resolveChannels, notifyDeps, logPrefix }, counts) => {
    const result = await runShiftVarianceAlertScan(db, { nowMinutes, notifyDeps, resolveChannels });
    counts.scanned = result.scannedUserCount;
    counts.created = result.created.length;
    counts.createdSelf = result.createdSelf.length;
    console.log(
      `${logPrefix} shift-variance-alert scan: scanned ${result.scannedUserCount} active users, created ${result.created.length} manager notification(s) and ${result.createdSelf.length} personal notification(s)`,
    );
  },

  // 有給付与の予告(docs/requirements.md §11、v0.7 フェーズ4)。宛先は「本人ではなく管理者
  // (leave.grant.manage 保持者)+テナント共有 Webhook」だけなので(シフト予実乖離と違い本人宛の系統を
  // 持たない)、resolveChannels ではなく notifyDeps のみを渡す。
  [SCAN_JOBS.leaveGrantProposal]: async ({ db, nowMinutes, notifyDeps, logPrefix }, counts) => {
    const result = await runLeaveGrantProposalScan(db, { nowMinutes, notifyDeps });
    counts.scanned = result.scannedUserCount;
    counts.created = result.created.length;
    console.log(
      `${logPrefix} leave-grant-proposal scan: scanned ${result.scannedUserCount} user(s) with hire date, created ${result.created.length} proposal(s)`,
    );
  },

  // 期限切れから7日以上経った未確認サインアップの掃除(セルフサインアップ、docs/design/saas.md)。
  // パスワードハッシュを持つ行を長く残さないための削除で、通知は出さない。SIGNUP_MODE が off の配備でも
  // pending_signups は空なので何も消えず、そのまま走らせてよい。
  [SCAN_JOBS.signupCleanup]: async ({ db, nowMinutes, logPrefix }, counts) => {
    const result = await runPendingSignupCleanup(db, { nowMinutes });
    counts.deleted = result.deletedCount;
    console.log(`${logPrefix} signup-cleanup: deleted ${result.deletedCount} stale pending signup(s)`);
    // 本人用パスワード再設定の再送スロットル行(password_reset_requests)も同じ定期ジョブで掃除する。
    const requests = await runPasswordResetRequestCleanup(db, { nowMinutes });
    console.log(`${logPrefix} signup-cleanup: deleted ${requests.deletedCount} stale password reset request row(s)`);
  },

  // 退会手続き中のテナントの再通知と、削除予定を過ぎたテナントの物理削除(docs/design/tenant-withdrawal.md)。
  // 1テナントの失敗で他のテナントを止めない(runTenantWithdrawalScan が受け止める)が、1件でも失敗が
  // あればジョブとしては失敗を記録する(次の回にもう一度試みる。削除は冪等)。
  [SCAN_JOBS.tenantWithdrawal]: async ({ db, nowMinutes, withdrawalMailer, purgeTransactional, logPrefix }, counts) => {
    const result = await runTenantWithdrawalScan(db, {
      nowMinutes,
      mailer: withdrawalMailer,
      ...(purgeTransactional !== undefined ? { transactional: purgeTransactional } : {}),
    });
    counts.reminded = result.remindedTenantIds.length;
    counts.purged = result.purgedTenantIds.length;
    // 出すのはテナント id だけ(名前は出さない)
    console.log(
      `${logPrefix} tenant-withdrawal: reminded ${result.remindedTenantIds.length} tenant(s), purged ${result.purgedTenantIds.length} tenant(s)${result.purgedTenantIds.length > 0 ? ` (${result.purgedTenantIds.join(", ")})` : ""}`,
    );
    for (const failure of result.failures) {
      console.error(`${logPrefix} tenant-withdrawal failed for tenant ${failure.tenantId}:`, failure.error);
    }
    if (result.failures.length > 0) return { error: result.failures[0]?.error };
  },
};

/** 失敗時のログの文言(従来の worker.ts のまま)。 */
const FAILURE_LABELS: Record<ScanJobName, string> = {
  [SCAN_JOBS.reminder]: "missing-clock-out scan",
  [SCAN_JOBS.overtimeAlert]: "overtime-alert scan",
  [SCAN_JOBS.leaveAlert]: "leave-alert scan",
  [SCAN_JOBS.shiftVarianceAlert]: "shift-variance-alert scan",
  [SCAN_JOBS.leaveGrantProposal]: "leave-grant-proposal scan",
  [SCAN_JOBS.signupCleanup]: "signup-cleanup",
  [SCAN_JOBS.tenantWithdrawal]: "tenant-withdrawal scan",
};

/**
 * スキャン1本の後始末(可観測性、docs/design/observability.md)。
 *
 * - 心拍を worker_heartbeats に書く(成功/失敗の累計は単調増加)。api の GET /metrics が読む
 * - 失敗していればエラー報告(SENTRY_DSN 未設定なら no-op)。文脈はスキャン名だけを渡す
 *   — 対象ユーザーやテナントは載せない(プライバシー: lib/error-report.ts 冒頭)
 *
 * 心拍の書き込み自体が失敗してもスキャンの成否には影響させない(観測のための書き込みで業務処理を落とさない)。
 */
async function finishScan(ctx: ScanJobContext, job: ScanJobName, err: unknown): Promise<void> {
  if (err !== undefined) ctx.errorReporter.capture(err, { job });
  try {
    await recordWorkerHeartbeat(ctx.db, { jobName: job, nowMinutes: ctx.nowMinutes, ok: err === undefined });
  } catch (heartbeatErr) {
    console.error(`${ctx.logPrefix} ${job} の心拍を記録できませんでした:`, heartbeatErr);
  }
}

/** スキャンを1本走らせる。**投げない**(失敗は `ok: false` で返し、心拍とエラー報告に残す)。 */
export async function runScanJob(job: ScanJobName, ctx: ScanJobContext): Promise<ScanJobOutcome> {
  const counts: ScanJobCounts = {};
  let error: unknown;
  try {
    const result = await JOB_BODIES[job](ctx, counts);
    if (result && result.error !== undefined) error = result.error;
  } catch (err) {
    console.error(`${ctx.logPrefix} ${FAILURE_LABELS[job]} failed:`, err);
    error = err ?? new Error(`${job} failed`);
  }
  await finishScan(ctx, job, error);
  return error === undefined ? { job, ok: true, counts } : { job, ok: false, counts, error };
}
