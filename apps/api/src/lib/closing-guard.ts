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

/**
 * 締め済み月への承認(amend)を D1 ではまだ扱えないときの 409 の error コード
 * (docs/design/d1-atomic-writes.md §6.1)。
 *
 * 判断点(2026-10-08、承認経路の atomic plan 移行): amend は「同じトランザクションで書いた打刻・申請の
 * 状態を読み直して月次を再計算する」ので atomic plan にできず、`db.transaction()` に残している。
 * D1 は `BEGIN` を拒否するため、そこへ入ると 500 になっていた。フェーズ2(書く予定の行を読み取り結果へ
 * 重ねる in-memory overlay)までは、**何も書かずに** この 409 で断る。締め前の月の承認は D1 でも通る。
 * 締めを解除(POST /closings/:period/reopen)してから承認し、締め直せば同じ結果に辿り着ける。
 */
export const AMEND_UNSUPPORTED_ON_D1 = "amend_unsupported_on_d1";

/** 承認ルート(corrections / leave / auto-break-waivers)の deps のうち、amend の可否に関わるもの。 */
export interface AmendCapabilityDeps {
  /**
   * `db.transaction()`(途中の結果で分岐できる対話的なトランザクション)が使えるか。省略時は
   * `supportsInteractiveTransactions(db)`(@kizami/db)でハンドルから判定する(D1 なら false)。
   * テストが Node の SQLite で「D1 の配備」を再現するときだけ明示する。
   */
  interactiveTransactions?: boolean;
}

/**
 * 承認が影響する月のうち、締め済みで amend が要るものを返す(順序は `periods` のまま)。
 * 締め済みの月があり actor が closing.unlock を持たなければ、assertAmendAllowed と同じく
 * MonthClosedRequiresUnlockError を投げる(409 `month_closed_requires_unlock`)。
 *
 * atomic plan の**前に**読む(計画の中では読めない)。読んだ後で締められた場合は、計画側の
 * 「まだ締められていない」の条件付き文 + ガードが拾う(@kizami/db の approveCorrectionRequest 等)。
 */
export async function closedPeriodsRequiringAmend(
  db: Database,
  params: { tenantId: string; periods: Iterable<string>; permissions: Map<PermissionKey, Scope> },
): Promise<string[]> {
  const closed: string[] = [];
  for (const period of params.periods) {
    if (await assertAmendAllowed(db, { tenantId: params.tenantId, period, permissions: params.permissions })) closed.push(period);
  }
  return closed;
}
