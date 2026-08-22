/**
 * 締め済み月への変更を全経路で拒否するための小さなガード。
 *
 * 依頼(禁止事項): 締め済み月への変更は POST /punches・POST /corrections・
 * POST /corrections/:id/approve の全経路で 409 `month_closed` を返す。
 *
 * `MonthClosedError` は ForbiddenError と同じパターンで app.ts の `onError` がグローバルに
 * 捕まえて 409 化する(呼び出し側は try/catch を書かずに `await assertMonthOpen(...)` する
 * だけでよい — apps/api/src/authz.ts の requireSelf/requirePermission と同じ設計)。
 */

import type { Database, Transaction } from "@kizami/db";
import { getClosingState } from "@kizami/db";

export class MonthClosedError extends Error {
  readonly period: string;

  constructor(period: string) {
    super(`period ${period} is closed`);
    this.name = "MonthClosedError";
    this.period = period;
  }
}

/** (tenantId, period) が締め済み(closed)なら MonthClosedError を投げる。open なら何もしない。 */
export async function assertMonthOpen(
  db: Database | Transaction,
  params: { tenantId: string; period: string },
): Promise<void> {
  const state = await getClosingState(db, { tenantId: params.tenantId, period: params.period });
  if (state.status === "closed") {
    throw new MonthClosedError(params.period);
  }
}
