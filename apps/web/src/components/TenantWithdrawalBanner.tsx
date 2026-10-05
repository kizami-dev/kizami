"use client";

import { Link } from "waku";
import { messages } from "../lib/messages";
import { useTenantWithdrawalNotice } from "../lib/tenantWithdrawal";
import { dateStrFromEpochMinutesJst, formatTimeJst } from "../lib/time";
import { Notice } from "./ui/Notice";

/**
 * 退会手続き中のテナントで、全画面のヘッダーの直下に出すお知らせ(2026-10-05、docs/design/tenant-withdrawal.md)。
 *
 * 手続き中にログインできるのは退会の権限を持つ管理者だけなので、ここが見えるのも管理者だけ。
 * 削除の予定日時と、エクスポート・取り消しの画面への導線を出す。通常の状態では何も描かない。
 * 状態は useAuthGuard が GET /me から読んで置く(lib/tenantWithdrawal.ts)。
 */
export function TenantWithdrawalBanner() {
  const notice = useTenantWithdrawalNotice();
  if (!notice) return null;
  const purgeAt = `${dateStrFromEpochMinutesJst(notice.scheduledPurgeAt)} ${formatTimeJst(notice.scheduledPurgeAt)}`;
  return (
    <div className="app-banner">
      <Notice tone="danger" role="status">
        <p>{messages.settingsWithdrawal.bannerBody(purgeAt)}</p>
        <p>
          <Link to="/settings/withdrawal">{messages.settingsWithdrawal.bannerLink}</Link>
        </p>
      </Notice>
    </div>
  );
}
