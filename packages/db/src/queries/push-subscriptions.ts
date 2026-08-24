/**
 * push_subscriptions に対するクエリ層(ブラウザプッシュ通知の購読)。
 *
 * すべての関数が tenantId を必須で受け取り WHERE に含める(docs/design/multi-tenancy.md の
 * テナント分離規約)。endpoint だけを鍵にした削除経路は用意しない — 他人の購読を
 * endpoint 文字列だけで消せてしまうため(API 層の tenant/user 固定と二重に守る)。
 */

import { and, eq, isNull } from "drizzle-orm";
import type { Database } from "../migrate.js";
import { pushSubscriptions } from "../schema/index.js";
import { uuidv7 } from "../uuid.js";

export type PushSubscription = typeof pushSubscriptions.$inferSelect;

export interface UpsertPushSubscriptionInput {
  tenantId: string;
  userId: string;
  endpoint: string;
  keysP256dh: string;
  keysAuth: string;
  userAgent: string | null;
  /** UTC エポック分 */
  createdAt: number;
}

/**
 * 購読を登録する。同じ (tenant, user, endpoint) が既にあれば鍵と User-Agent を更新し、
 * `failed_at` を null に戻す(失効扱いだったブラウザが再購読した場合の復活経路)。
 * ブラウザは鍵を再生成することがあるため、endpoint が同じでも鍵は必ず上書きする。
 */
export async function upsertPushSubscription(db: Database, input: UpsertPushSubscriptionInput): Promise<PushSubscription> {
  const [row] = await db
    .insert(pushSubscriptions)
    .values({
      id: uuidv7(),
      tenantId: input.tenantId,
      userId: input.userId,
      endpoint: input.endpoint,
      keysP256dh: input.keysP256dh,
      keysAuth: input.keysAuth,
      userAgent: input.userAgent,
      createdAt: input.createdAt,
      lastUsedAt: null,
      failedAt: null,
    })
    .onConflictDoUpdate({
      target: [pushSubscriptions.tenantId, pushSubscriptions.userId, pushSubscriptions.endpoint],
      set: {
        keysP256dh: input.keysP256dh,
        keysAuth: input.keysAuth,
        userAgent: input.userAgent,
        failedAt: null,
      },
    })
    .returning();
  if (!row) {
    throw new Error("upsertPushSubscription: insert/update returned no row");
  }
  return row;
}

/** 送信可能な(failed_at が立っていない)購読を返す。 */
export async function listActivePushSubscriptions(
  db: Database,
  params: { tenantId: string; userId: string },
): Promise<PushSubscription[]> {
  return db
    .select()
    .from(pushSubscriptions)
    .where(
      and(
        eq(pushSubscriptions.tenantId, params.tenantId),
        eq(pushSubscriptions.userId, params.userId),
        isNull(pushSubscriptions.failedAt),
      ),
    );
}

/** 本人の購読を1件削除する(UI の「このブラウザで受け取るのをやめる」)。削除できたら true。 */
export async function deletePushSubscription(
  db: Database,
  params: { tenantId: string; userId: string; endpoint: string },
): Promise<boolean> {
  const deleted = await db
    .delete(pushSubscriptions)
    .where(
      and(
        eq(pushSubscriptions.tenantId, params.tenantId),
        eq(pushSubscriptions.userId, params.userId),
        eq(pushSubscriptions.endpoint, params.endpoint),
      ),
    )
    .returning();
  return deleted.length > 0;
}

/**
 * プッシュサービスが 404/410 を返した購読に failed_at を立てる(行は消さない — 遅延プルーニング。
 * 判断点は schema/push-subscriptions.ts のヘッダコメント)。
 */
export async function markPushSubscriptionFailed(
  db: Database,
  params: { tenantId: string; userId: string; endpoint: string; failedAt: number },
): Promise<void> {
  await db
    .update(pushSubscriptions)
    .set({ failedAt: params.failedAt })
    .where(
      and(
        eq(pushSubscriptions.tenantId, params.tenantId),
        eq(pushSubscriptions.userId, params.userId),
        eq(pushSubscriptions.endpoint, params.endpoint),
      ),
    );
}

/** 送信に成功した購読の last_used_at を更新する(設定画面で「最後に届いた時刻」を出すため)。 */
export async function touchPushSubscription(
  db: Database,
  params: { tenantId: string; userId: string; endpoint: string; lastUsedAt: number },
): Promise<void> {
  await db
    .update(pushSubscriptions)
    .set({ lastUsedAt: params.lastUsedAt })
    .where(
      and(
        eq(pushSubscriptions.tenantId, params.tenantId),
        eq(pushSubscriptions.userId, params.userId),
        eq(pushSubscriptions.endpoint, params.endpoint),
      ),
    );
}
