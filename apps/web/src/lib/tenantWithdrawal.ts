"use client";

import { useSyncExternalStore } from "react";
import type { AuthTenant } from "./api";

/**
 * 退会手続き中のバナー(components/TenantWithdrawalBanner.tsx)のための、退会の状態の共有ストア
 * (2026-10-05、docs/design/tenant-withdrawal.md)。
 *
 * 判断点: バナーは全画面のヘッダー(AppHeader)に出すが、AppHeader は30を超える画面から props で
 * 呼ばれていて、そのすべてに状態を渡し直すのは変更が大きい。一方で各画面は必ず useAuthGuard で
 * GET /me を読んでおり、/me は退会の状態(tenant.withdrawal)を返す。そこで useAuthGuard が
 * 読んだ値をこのストアへ置き、AppHeader はここを購読する(追加の通信は無い)。退会の画面で
 * 申請・取り消しをしたときも、このストアを書き換えればバナーがすぐに出る・消える。
 */

export type TenantWithdrawalNotice = { requestedAt: number; scheduledPurgeAt: number } | null;

let current: TenantWithdrawalNotice = null;
const listeners = new Set<() => void>();

export function setTenantWithdrawalNotice(next: TenantWithdrawalNotice): void {
  if (current?.scheduledPurgeAt === next?.scheduledPurgeAt && current?.requestedAt === next?.requestedAt) return;
  current = next;
  for (const listener of listeners) listener();
}

/** GET /me の tenant から取り込む(古い API で withdrawal が無ければ通常の状態とみなす)。 */
export function setTenantWithdrawalNoticeFromTenant(tenant: AuthTenant | null): void {
  setTenantWithdrawalNotice(tenant?.withdrawal ?? null);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** 退会手続き中なら削除予定の時刻など、通常の状態なら null。 */
export function useTenantWithdrawalNotice(): TenantWithdrawalNotice {
  return useSyncExternalStore(
    subscribe,
    () => current,
    // 静的書き出し(サーバー描画)の時点では常に通常の状態
    () => null,
  );
}

/** API のエラー body が「退会手続き中」か(401/403/409 の `{ error: "tenant_withdrawing" }`)。 */
export function isTenantWithdrawingError(body: unknown): boolean {
  return typeof body === "object" && body !== null && (body as { error?: unknown }).error === "tenant_withdrawing";
}
