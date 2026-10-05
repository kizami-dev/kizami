/**
 * 退会手続き中のテナントの定期処理(2026-10-05、docs/design/tenant-withdrawal.md)。
 *
 * - 削除予定の7日前を過ぎたテナントへ再通知のメールを1回だけ送る
 * - 削除予定の時刻を過ぎたテナントを物理削除し(@kizami/db の purgeTenant)、完了のメールを送る
 *
 * 他のスキャン(reminders.ts 等)と同じ作法で、BullMQ にも Valkey にも依存しない関数として切り出し、
 * worker.ts の定期ジョブから呼ぶ。運用者 CLI の「今すぐ削除」(operator.ts の `tenant purge`)も
 * 同じ `purgeWithdrawnTenant` を通る(メールの扱いも同じ)。
 *
 * ## メール(システムメールがある配備だけ)
 *
 * 完了のメールの宛先(`tenant.withdraw` を持つ人のメールアドレス)は、**削除の前に**集めておく
 * (削除の後はユーザーの行ごと無いので分からない)。宛先は削除の記録には残さない(個人情報を
 * 含まない記録 — schema/tenant-purges.ts)。そのため、D1 で途中まで消えた後の再実行では
 * ユーザーの行が既に無く、完了のメールは出せない(画面にもう入れないので、運用者からの連絡になる)。
 * メールの送信に失敗しても削除は巻き戻さない(ログのみ)。
 */

import { listTenantsDueForPurge, listTenantsDueForWithdrawalReminder, markWithdrawalReminderSent, purgeTenant, type Database, type PurgeTenantResult } from "@kizami/db";
import type { SystemMailSendFn } from "./lib/system-mail.js";
import {
  buildWithdrawalCompletedMail,
  buildWithdrawalReminderMail,
  listWithdrawalNoticeRecipients,
  WITHDRAWAL_REMINDER_LEAD_MINUTES,
} from "./lib/tenant-withdrawal.js";

/** 退会のメールの送り先(無ければ null = メールを出さない)。 */
export interface TenantWithdrawalMailer {
  appBaseUrl: string;
  sendMail: SystemMailSendFn;
}

async function sendAll(mailer: TenantWithdrawalMailer, recipients: readonly string[], mail: { subject: string; text: string }, label: string): Promise<number> {
  let sent = 0;
  for (const to of recipients) {
    try {
      await mailer.sendMail({ to, ...mail });
      sent += 1;
    } catch (err) {
      console.error(`[tenant-withdrawal] failed to send the ${label} mail:`, err);
    }
  }
  return sent;
}

/**
 * 退会を申請したテナント1つを物理削除し、システムメールがあれば完了を知らせる。
 * 削除予定の時刻は見ない(定期ジョブは予定を過ぎたテナントだけを渡し、運用者 CLI は待たずに渡す)。
 */
export async function purgeWithdrawnTenant(
  db: Database,
  params: { tenantId: string; nowMinutes: number; mailer: TenantWithdrawalMailer | null; transactional?: boolean },
): Promise<PurgeTenantResult & { mailsSent: number }> {
  const recipients = params.mailer ? await listWithdrawalNoticeRecipients(db, params.tenantId) : [];
  const result = await purgeTenant(db, {
    tenantId: params.tenantId,
    now: params.nowMinutes,
    ...(params.transactional !== undefined ? { transactional: params.transactional } : {}),
  });
  let mailsSent = 0;
  if (result.status === "purged" && params.mailer) {
    mailsSent = await sendAll(params.mailer, recipients, buildWithdrawalCompletedMail(), "completion");
  }
  return { ...result, mailsSent };
}

export interface TenantWithdrawalScanResult {
  /** 再通知を送ったテナント */
  remindedTenantIds: string[];
  /** 削除を完了したテナント */
  purgedTenantIds: string[];
  /** 失敗したテナント(次の回にもう一度試みる) */
  failures: Array<{ tenantId: string; error: unknown }>;
}

/**
 * 定期ジョブの本体。1つのテナントの失敗で他のテナントを止めないよう、テナントごとに例外を受け止めて
 * `failures` に積む(呼び出し側は1件でもあればジョブを失敗として記録する)。冪等。
 */
export async function runTenantWithdrawalScan(
  db: Database,
  params: { nowMinutes: number; mailer: TenantWithdrawalMailer | null },
): Promise<TenantWithdrawalScanResult> {
  const result: TenantWithdrawalScanResult = { remindedTenantIds: [], purgedTenantIds: [], failures: [] };

  for (const tenant of await listTenantsDueForWithdrawalReminder(db, { now: params.nowMinutes, leadMinutes: WITHDRAWAL_REMINDER_LEAD_MINUTES })) {
    try {
      // 印を先に付けてから送る(重なって走っても1通だけ。queries/tenant-withdrawal.ts の markWithdrawalReminderSent)。
      // システムメールの無い配備でも印は付ける(画面に出ている削除予定日がすべて)。
      if (!(await markWithdrawalReminderSent(db, { tenantId: tenant.id, sentAt: params.nowMinutes }))) continue;
      if (params.mailer && tenant.withdrawalScheduledPurgeAt !== null) {
        const recipients = await listWithdrawalNoticeRecipients(db, tenant.id);
        const mail = buildWithdrawalReminderMail({ appBaseUrl: params.mailer.appBaseUrl, scheduledPurgeAt: tenant.withdrawalScheduledPurgeAt });
        await sendAll(params.mailer, recipients, mail, "reminder");
      }
      result.remindedTenantIds.push(tenant.id);
    } catch (error) {
      result.failures.push({ tenantId: tenant.id, error });
    }
  }

  for (const tenant of await listTenantsDueForPurge(db, { now: params.nowMinutes })) {
    try {
      const purged = await purgeWithdrawnTenant(db, { tenantId: tenant.id, nowMinutes: params.nowMinutes, mailer: params.mailer });
      if (purged.status === "purged") result.purgedTenantIds.push(tenant.id);
    } catch (error) {
      result.failures.push({ tenantId: tenant.id, error });
    }
  }

  return result;
}
