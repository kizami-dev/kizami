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
import type { Database, Transaction } from "../migrate.js";
import { invitations, users } from "../schema/index.js";

/** isActive を false にする(退職処理)。対象が存在しない場合は例外を投げる(呼び出し側が事前に存在確認する前提)。 */
export async function deactivateUser(db: Database | Transaction, params: { tenantId: string; userId: string }): Promise<typeof users.$inferSelect> {
  const [row] = await db
    .update(users)
    .set({ isActive: false })
    .where(and(eq(users.tenantId, params.tenantId), eq(users.id, params.userId)))
    .returning();
  if (!row) {
    throw new Error(`deactivateUser: user not found: ${params.userId}`);
  }
  return row;
}

/** isActive を true に戻す(再有効化)。対象が存在しない場合は例外を投げる(呼び出し側が事前に存在確認する前提)。 */
export async function reactivateUser(db: Database | Transaction, params: { tenantId: string; userId: string }): Promise<typeof users.$inferSelect> {
  const [row] = await db
    .update(users)
    .set({ isActive: true })
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
  await db
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
