/**
 * 期限切れの未確認サインアップ(pending_signups)の掃除(セルフサインアップ、docs/design/saas.md)。
 *
 * pending_signups はパスワードのハッシュを持つ。確認されないまま放置された行にそれを
 * 長く残さないよう、**期限(登録から24時間)から7日以上経った未消費の行**を削除する。
 * 期限切れ直後ではなく7日の猶予を置くのは、「リンクが切れました」の問い合わせに対して
 * 運用者が登録の事実(いつ・どのメールで)を調べられる余地を残すため。消費済みの行
 * (テナント作成の記録)は消さない。
 *
 * 他のスキャン(reminders.ts 等)と同じ作法で、BullMQ にも Valkey にも依存しない純粋な関数として
 * 切り出し、worker.ts の定期ジョブから呼ぶ(要件 §8: キュー層は差し替え可能)。
 * 冪等で、何度走らせても結果は同じ。
 */

import { deleteStalePendingSignups, type Database } from "@kizami/db";

/** 期限切れから削除までの猶予(7日、分単位)。 */
export const PENDING_SIGNUP_RETENTION_AFTER_EXPIRY_MINUTES = 7 * 24 * 60;

export interface PendingSignupCleanupResult {
  deletedCount: number;
}

export async function runPendingSignupCleanup(db: Database, params: { nowMinutes: number }): Promise<PendingSignupCleanupResult> {
  const deletedCount = await deleteStalePendingSignups(db, {
    expiredBefore: params.nowMinutes - PENDING_SIGNUP_RETENTION_AFTER_EXPIRY_MINUTES,
  });
  return { deletedCount };
}
