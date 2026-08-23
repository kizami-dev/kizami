/**
 * sessions への書き込みクエリ(新規、Tier 0)。
 *
 * 「当該ユーザーの全セッションを失効させる」という要求がパスワードリセット使用時
 * (queries/password-resets.ts の usePasswordResetToken)と退職処理(無効化、
 * apps/api/src/routes/members.ts の POST /:id/deactivate)の2箇所から出るため、
 * 共有のクエリとして切り出す。個別の1セッションのログアウト(apps/api/src/routes/auth.ts の
 * POST /logout)はここでは扱わない(そちらは token → sessionId 変換を伴う認証層の関心事)。
 */

import { and, eq, isNull } from "drizzle-orm";
import type { Database, Transaction } from "../migrate.js";
import { sessions } from "../schema/index.js";

/** そのユーザーの有効な(未失効)セッションを全て失効させる。対象0件でも冪等に成功する。 */
export async function revokeAllSessionsForUser(
  db: Database | Transaction,
  params: { tenantId: string; userId: string; revokedAt: number },
): Promise<void> {
  await db
    .update(sessions)
    .set({ revokedAt: params.revokedAt })
    .where(and(eq(sessions.tenantId, params.tenantId), eq(sessions.userId, params.userId), isNull(sessions.revokedAt)));
}
