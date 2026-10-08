/**
 * 退職処理(無効化)/ 再有効化(新規、Tier 0)。apps/api/src/routes/members.ts の
 * POST /:id/deactivate, POST /:id/reactivate が使う。
 *
 * isActive の更新はここに置くが、無効化に伴う「pending 招待の revoke」は
 * queries/invitations.ts を編集せず(このセクションの変更対象は「packages/db/src/queries/ の
 * 新規ファイルのみ」— 並行作業との競合を避ける方針)、invitations テーブルへ直接1本の
 * UPDATE で反映する。招待の不変条件「未決着(未受諾・未失効)はユーザーごとに高々1本」
 * (queries/invitations.ts の createInvitation コメント参照)により、対象を1件ずつ SELECT で
 * 特定する必要がなく、WHERE 句のみで冪等に revoke できる(0件でもエラーにならない)。
 *
 * 「未使用リセットトークンの revoke」は同じ理由で queries/password-resets.ts 側に
 * revokeAllPasswordResetTokensForUser として定義してある(そちらは今回の新規ファイルなので
 * 素直にそこへ置いた)。
 */

import { and, eq, isNull } from "drizzle-orm";
import { AtomicPlan, runAtomic, type AtomicExecutor } from "../atomic.js";
import type { Database, Transaction } from "../types.js";
import { invitations, users } from "../schema/index.js";
import { auditLogInsertQuery } from "./audit.js";
import { revokeAllPasswordResetTokensForUserQuery } from "./password-resets.js";
import { revokeAllSessionsForUserQuery } from "./sessions.js";

/**
 * isActive を false にする(退職処理)。対象が存在しない場合は例外を投げる(呼び出し側が事前に存在確認する前提)。
 *
 * 2026-08-27: `deactivatedAt`(退職日 = 個人データ保持期間の起算日)も同時に記録する。
 * これが無いと「いつ退職したか」が分からず、消去可能日を決められない
 * (packages/db/src/schema/users.ts の deactivatedAt のコメント参照)。
 * `deactivatedAt` を省略した呼び出しは既存の挙動どおり isActive だけを落とす。
 */
export async function deactivateUser(
  db: Database | Transaction,
  params: { tenantId: string; userId: string; deactivatedAt?: number },
): Promise<typeof users.$inferSelect> {
  const [row] = await db
    .update(users)
    .set(params.deactivatedAt === undefined ? { isActive: false } : { isActive: false, deactivatedAt: params.deactivatedAt })
    .where(and(eq(users.tenantId, params.tenantId), eq(users.id, params.userId)))
    .returning();
  if (!row) {
    throw new Error(`deactivateUser: user not found: ${params.userId}`);
  }
  return row;
}

/**
 * isActive を true に戻す(再有効化)。対象が存在しない場合は例外を投げる(呼び出し側が事前に存在確認する前提)。
 *
 * 2026-08-27: `deactivatedAt` を null に戻す。復職した人に「退職日」は無く、値を残したままにすると
 * その人がいつまでも「消去可能になった退職者」の一覧に現れてしまう。
 * `erasedAt` は触らない — 消去済みの行はそもそもこの関数を通さない(routes/members.ts が 409 で弾く)。
 */
export async function reactivateUser(db: Database | Transaction, params: { tenantId: string; userId: string }): Promise<typeof users.$inferSelect> {
  const [row] = await db
    .update(users)
    .set({ isActive: true, deactivatedAt: null })
    .where(and(eq(users.tenantId, params.tenantId), eq(users.id, params.userId)))
    .returning();
  if (!row) {
    throw new Error(`reactivateUser: user not found: ${params.userId}`);
  }
  return row;
}

/**
 * 対象ユーザーの未決着(未受諾・未失効)招待があれば一括 revoke する(退職処理用)。
 * 「未決着は高々1本」の不変条件により、対象が無くても冪等に成功する(0件更新)。
 */
export async function revokePendingInvitationForUser(
  db: Database | Transaction,
  params: { tenantId: string; userId: string; revokedAt: number },
): Promise<void> {
  await revokePendingInvitationForUserQuery(db, params);
}

/** revokePendingInvitationForUser と同じ update ビルダを返す(実行しない。atomic plan 用)。 */
function revokePendingInvitationForUserQuery(q: AtomicExecutor, params: { tenantId: string; userId: string; revokedAt: number }) {
  return q
    .update(invitations)
    .set({ revokedAt: params.revokedAt })
    .where(
      and(
        eq(invitations.tenantId, params.tenantId),
        eq(invitations.userId, params.userId),
        isNull(invitations.acceptedAt),
        isNull(invitations.revokedAt),
      ),
    );
}

export interface DeactivateMemberInput {
  tenantId: string;
  userId: string;
  /** 操作した管理者(監査ログの actor) */
  actorId: string;
  /** UTC エポック分。deactivated_at・各失効時刻・監査ログの occurred_at に使う */
  nowMinutes: number;
}

/**
 * 退職処理(POST /members/:id/deactivate)の書き込み一式を1単位で行う: 無効化(退職日の記録)→
 * 全セッションの失効 → 未決着の招待の失効 → 未決着の再設定トークンの失効 → 監査ログ `member.deactivate`。
 *
 * 判断点(2026-10-08、D1 対応。docs/design/d1-atomic-writes.md #24): db.transaction() から
 * atomic plan(src/atomic.ts)へ移した。どれも途中の結果で分岐しない書き込みだが、従来の
 * `deactivateUser` は対象が無ければ例外にしていたので、users の UPDATE の直後にガード
 * `member.deactivate.user` を置いて同じ挙動を保つ(呼び出し側が事前に存在確認するので、
 * 通常は起きない不変条件違反 — 何も書かずに例外)。
 */
export async function deactivateMember(db: Database, input: DeactivateMemberInput): Promise<void> {
  const { tenantId, userId, nowMinutes } = input;
  const plan = new AtomicPlan();
  plan.add((q) =>
    q
      .update(users)
      .set({ isActive: false, deactivatedAt: nowMinutes })
      .where(and(eq(users.tenantId, tenantId), eq(users.id, userId)))
      .returning({ id: users.id }),
  );
  plan.guard("member.deactivate.user");
  plan.add((q) => revokeAllSessionsForUserQuery(q, { tenantId, userId, revokedAt: nowMinutes }));
  plan.add((q) => revokePendingInvitationForUserQuery(q, { tenantId, userId, revokedAt: nowMinutes }));
  plan.add((q) => revokeAllPasswordResetTokensForUserQuery(q, { tenantId, userId, revokedAt: nowMinutes }));
  plan.add((q) =>
    auditLogInsertQuery(q, {
      tenantId,
      actorId: input.actorId,
      action: "member.deactivate",
      targetType: "user",
      targetId: userId,
      detail: JSON.stringify({}),
      occurredAt: nowMinutes,
    }),
  );
  const result = await runAtomic(db, plan);
  if (!result.ok) {
    throw new Error(`deactivateMember: user not found: ${userId}`);
  }
}
