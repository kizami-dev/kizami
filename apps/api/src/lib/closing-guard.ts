/**
 * 締め済み月への変更を全経路で拒否するための小さなガード。
 *
 * 依頼(禁止事項): 締め済み月への打刻(POST /punches)は引き続き全経路で 409 `month_closed` を
 * 返す(打刻は締め後修正の対象外。必ず修正申請を経由させる、意図的な制約)。
 *
 * `MonthClosedError` は ForbiddenError と同じパターンで app.ts の `onError` がグローバルに
 * 捕まえて 409 化する(呼び出し側は try/catch を書かずに `await assertMonthOpen(...)` する
 * だけでよい — apps/api/src/authz.ts の requireSelf/requirePermission と同じ設計)。
 *
 * 締め後修正(amend, v0.4): POST /corrections・POST /leave/requests は締め済み月でも申請の
 * *作成*を許す(申請は意思表示の記録に過ぎない)ため、もう assertMonthOpen を呼ばない。
 * 代わりに、承認(POST /corrections/:id/approve・POST /leave/requests/:id/approve)が
 * 締め済み月に影響する場合だけ `assertAmendAllowed` を呼ぶ: 開いていれば無条件で許可、
 * 閉じていれば `closing.unlock` 権限(department_and_descendants 以上、
 * docs/design/permission-catalog.md §1.5 と同じスコープ下限)を持つ場合のみ許可する。
 */

import { hasPermission as evaluatePermission, type PermissionKey, type Scope } from "@kizami/authz";
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

/** assertAmendAllowed 専用: 締め済み月に影響する承認だが、actor が closing.unlock を持たない。 */
export class MonthClosedRequiresUnlockError extends Error {
  readonly period: string;

  constructor(period: string) {
    super(`period ${period} is closed; amending it requires the closing.unlock permission`);
    this.name = "MonthClosedRequiresUnlockError";
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

const UNLOCK_PERMISSION: PermissionKey = "closing.unlock";
const UNLOCK_REQUIRED_SCOPE: Scope = "department_and_descendants";

/**
 * 修正申請・休暇申請の承認が (tenantId, period) に影響する場合のガード。
 *
 * - period が open: 何もせず false を返す(通常の承認フローのまま)
 * - period が closed かつ actor が closing.unlock を持つ: 何もせず true を返す
 *   (呼び出し側はこれを「amend の追記・スナップショット再計算が必要」の合図として使う)
 * - period が closed かつ actor が closing.unlock を持たない: MonthClosedRequiresUnlockError
 *   を投げる(app.ts の onError が 409 `month_closed_requires_unlock` に変換する)
 */
export async function assertAmendAllowed(
  db: Database | Transaction,
  params: { tenantId: string; period: string; permissions: Map<PermissionKey, Scope> },
): Promise<boolean> {
  const state = await getClosingState(db, { tenantId: params.tenantId, period: params.period });
  if (state.status !== "closed") {
    return false;
  }
  if (!evaluatePermission(params.permissions, UNLOCK_PERMISSION, UNLOCK_REQUIRED_SCOPE)) {
    throw new MonthClosedRequiresUnlockError(params.period);
  }
  return true;
}
