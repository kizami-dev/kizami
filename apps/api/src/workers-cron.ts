/**
 * Cloudflare Workers の Cron Triggers から定期スキャンを走らせる(2026-10-07、docs/design/workers-d1.md「定期スキャン」)。
 *
 * Node 版の src/worker.ts(BullMQ + Valkey)に相当する。**スキャン本体も1本ずつの実行(失敗の隔離・ログ・心拍・
 * エラー報告)も Node と同じもの**(scheduled-jobs.ts の runScanJob)を呼び、ここが持つのは「どの cron 式で
 * どのスキャンを走らせるか」の対応表だけ。env からの依存の組み立ては workers.ts の `scheduled()` が行う
 * (このファイルは env を知らない — Node のテストから SQLite で同じ対応表を検査できるようにするため)。
 *
 * ## 周期(判断点)
 *
 * Node は全スキャンを1つの repeatable job で `REMINDER_INTERVAL_MINUTES`(既定 15)分ごとに順に走らせる
 * (BullMQ の `every`。cron 式でも JST でもない)。Workers でも**周期は同じ 15 分**にし、**スキャン1本に
 * cron 式を1本**割り当てて、開始の分を1分ずつずらす(下の表)。1本ずつ別の起動にするのは:
 *
 * - CPU 時間(Cron は 1 起動 30 秒 — 1時間未満の周期の場合)と D1 のクエリ数(1 起動 1000 本、Paid)の
 *   上限が**起動ごと**に掛かる。7本を1起動に詰めると重いスキャン(36協定)が他の本の枠まで食う
 * - 上限で起動ごと打ち切られても、巻き込まれるのはその1本だけ(心拍が古くなって `/metrics` で分かる)
 * - 開始をずらすのは、同じ D1 へ7本が同時に読みに行かないため
 *
 * Cron Triggers は **UTC** で評価されるが、どれも「N 分ごと」なので時差の換算は要らない。日付の境目
 * (打刻忘れは日界を過ぎた勤怠日、有給の段階は日本時間の残日数、利用上限の1日は日本時間 0 時区切り)は
 * スキャンの中で `nowMinutes` と JST のオフセットから求めており、起動の時刻には依存しない。
 *
 * 周期を変えたいときは **apps/api/wrangler.jsonc の `triggers.crons` とこの表の両方**を直すこと
 * (`controller.cron` は設定の文字列そのもので届くので、文字が1つ違えば対応しない)。食い違いは
 * test/scheduled-jobs.test.ts が落とす。対応の無い cron 式で起動したら何も走らせずにエラーを記録する。
 *
 * ## 冪等と再試行
 *
 * `nowMinutes` には壁時計ではなく **Cron の予定時刻(`scheduledTime`)** を使う。再試行・二重起動でも同じ
 * 「今」になり、通知の UNIQUE・印による重複防止がそのまま効く(各スキャンの重複防止は scheduled-jobs.ts 冒頭)。
 * 1本でも失敗したら `noRetry()` を呼んでから投げる: Cron Events に失敗として残しつつ、成功した本まで
 * 巻き込む即時の再試行はさせない(次の回 = 15 分後にもう一度走る。Node と同じ)。
 *
 * ## D1 で変わること
 *
 * - 退会テナントの物理削除は `transactional: false`(D1 は `BEGIN` を拒否する)。テーブルごとに1文ずつ、
 *   外部キーの子から親の順に消し、途中で止まっても次の回が続きから完了する(docs/design/tenant-withdrawal.md)
 * - 他のスキャンは `db.transaction()` を使わない(読み取り + 1文ずつの INSERT/UPDATE/DELETE)ので、そのまま動く
 */

import { createPersonalChannelResolver, runScanJob, SCAN_JOBS, type ScanJobContext, type ScanJobName, type ScanJobOutcome } from "./scheduled-jobs.js";
import type { BuildPersonalChannelsOptions } from "./lib/notification-channels.js";

/**
 * cron 式 → 走らせるスキャン。**apps/api/wrangler.jsonc の `triggers.crons` と一字一句揃えること**。
 * 15 分ごと・開始を1分ずつずらす(冒頭「周期」)。
 */
export const WORKERS_CRON_SCHEDULE = {
  "0,15,30,45 * * * *": [SCAN_JOBS.reminder],
  "1,16,31,46 * * * *": [SCAN_JOBS.overtimeAlert],
  "2,17,32,47 * * * *": [SCAN_JOBS.leaveAlert],
  "3,18,33,48 * * * *": [SCAN_JOBS.shiftVarianceAlert],
  "4,19,34,49 * * * *": [SCAN_JOBS.leaveGrantProposal],
  "5,20,35,50 * * * *": [SCAN_JOBS.signupCleanup],
  "6,21,36,51 * * * *": [SCAN_JOBS.tenantWithdrawal],
} as const satisfies Record<string, readonly ScanJobName[]>;

/** ログの接頭辞(Node のワーカーの "[kizami-reminders]" と区別する)。 */
export const WORKERS_CRON_LOG_PREFIX = "[kizami-cron]";

/** cron 式に対応するスキャン。対応が無ければ undefined。 */
export function jobsForCron(cron: string): readonly ScanJobName[] | undefined {
  return Object.prototype.hasOwnProperty.call(WORKERS_CRON_SCHEDULE, cron)
    ? WORKERS_CRON_SCHEDULE[cron as keyof typeof WORKERS_CRON_SCHEDULE]
    : undefined;
}

/** 1回の起動に要る依存(workers.ts が env から組み立てる)。 */
export type WorkersCronDeps = Omit<ScanJobContext, "nowMinutes" | "resolveChannels" | "logPrefix" | "purgeTransactional"> & {
  /** 本人の個人チャネルの組み立てに使う依存(nowMinutes は起動ごとに足す) */
  personalChannelOptions: Omit<BuildPersonalChannelsOptions, "nowMinutes">;
};

export interface WorkersCronResult {
  cron: string;
  nowMinutes: number;
  /** 対応表に無い cron 式で起動された(何も走らせていない) */
  unknownCron: boolean;
  outcomes: ScanJobOutcome[];
}

/**
 * cron 式に対応するスキャンを順に走らせる。**投げない**(失敗は outcomes の ok=false)。
 * 投げるかどうか(Cron Events に失敗を残すか)は呼び出し側(workers.ts)が決める。
 */
export async function runWorkersCron(params: { cron: string; scheduledTime: number; deps: WorkersCronDeps }): Promise<WorkersCronResult> {
  const { cron, deps } = params;
  // 予定時刻を「今」にする(冒頭「冪等と再試行」)
  const nowMinutes = Math.floor(params.scheduledTime / 60_000);
  const jobs = jobsForCron(cron);
  if (jobs === undefined) {
    console.error(
      `${WORKERS_CRON_LOG_PREFIX} no scan is mapped to cron "${cron}"; nothing ran. Keep wrangler.jsonc triggers.crons and WORKERS_CRON_SCHEDULE (src/workers-cron.ts) in sync`,
    );
    return { cron, nowMinutes, unknownCron: true, outcomes: [] };
  }

  const { personalChannelOptions, ...rest } = deps;
  const ctx: ScanJobContext = {
    ...rest,
    nowMinutes,
    resolveChannels: createPersonalChannelResolver(deps.db, { ...personalChannelOptions, nowMinutes }),
    // D1 は BEGIN を拒否する(冒頭「D1 で変わること」)
    purgeTransactional: false,
    logPrefix: WORKERS_CRON_LOG_PREFIX,
  };

  const outcomes: ScanJobOutcome[] = [];
  // 1本ずつ順に(同時に走らせると 1 起動 6 本の同時接続の上限と D1 の読み取りを取り合う)
  for (const job of jobs) outcomes.push(await runScanJob(job, ctx));
  return { cron, nowMinutes, unknownCron: false, outcomes };
}
