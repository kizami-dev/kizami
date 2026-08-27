/**
 * user_totp / user_totp_recovery_codes のクエリ層(二要素認証、2026-08-27)。
 * 設計判断は packages/db/src/schema/totp.ts と docs/design/two-factor-auth.md を参照。
 *
 * このレイヤは **暗号処理を一切知らない**(共有鍵は "enc:v1:..." の文字列として受け渡すだけ、
 * リカバリコードは SHA-256 hex として受け渡すだけ)。暗号化・ハッシュ化は apps/api の責務
 * (packages/db は他の秘密情報カラムでも同じ分担にしてある — schema/oidc.ts 参照)。
 */

import { and, eq, isNull } from "drizzle-orm";
import type { Database, Transaction } from "../types.js";
import { userTotp, userTotpRecoveryCodes } from "../schema/index.js";
import { uuidv7 } from "../uuid.js";

export type UserTotp = typeof userTotp.$inferSelect;
export type UserTotpRecoveryCode = typeof userTotpRecoveryCodes.$inferSelect;

/** ユーザーの TOTP 行を取得する(セットアップ中=enabledAt が null の行も返す)。 */
export async function getUserTotp(db: Database | Transaction, params: { tenantId: string; userId: string }): Promise<UserTotp | null> {
  const rows = await db
    .select()
    .from(userTotp)
    .where(and(eq(userTotp.tenantId, params.tenantId), eq(userTotp.userId, params.userId)))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * セットアップ中の行を作る(既存行があれば共有鍵を差し替え、enabledAt / lastUsedCounter を
 * 初期化する)。
 *
 * 「有効化済みのユーザーが setup をやり直すと 2FA が黙って外れる」事故を防ぐため、
 * **有効化済みの行を上書きするかどうかの判断はこの関数では行わない** — 呼び出し側
 * (apps/api の POST /auth/totp/setup)が enabledAt を見て 409 を返す。
 */
export async function upsertPendingUserTotp(
  db: Database | Transaction,
  params: { tenantId: string; userId: string; secretEncrypted: string; createdAt: number },
): Promise<void> {
  const existing = await getUserTotp(db, { tenantId: params.tenantId, userId: params.userId });
  if (existing) {
    await db
      .update(userTotp)
      .set({ secretEncrypted: params.secretEncrypted, enabledAt: null, lastUsedCounter: null })
      .where(eq(userTotp.userId, params.userId));
    return;
  }
  await db.insert(userTotp).values({
    userId: params.userId,
    tenantId: params.tenantId,
    secretEncrypted: params.secretEncrypted,
    enabledAt: null,
    lastUsedCounter: null,
    createdAt: params.createdAt,
  });
}

/** セットアップを完了させる(enabledAt を立て、確認に使ったカウンタを記録する)。 */
export async function enableUserTotp(
  db: Database | Transaction,
  params: { tenantId: string; userId: string; enabledAt: number; lastUsedCounter: number },
): Promise<void> {
  await db
    .update(userTotp)
    .set({ enabledAt: params.enabledAt, lastUsedCounter: params.lastUsedCounter })
    .where(and(eq(userTotp.tenantId, params.tenantId), eq(userTotp.userId, params.userId)));
}

/** リプレイ防止用に、最後に受理したカウンタを記録する。 */
export async function updateUserTotpLastUsedCounter(
  db: Database | Transaction,
  params: { userId: string; lastUsedCounter: number },
): Promise<void> {
  await db.update(userTotp).set({ lastUsedCounter: params.lastUsedCounter }).where(eq(userTotp.userId, params.userId));
}

/**
 * 2FA を完全に解除する(TOTP 行とリカバリコードを削除)。
 * 本人による無効化と、管理者によるリセット(ロックアウト救済)の両方で使う。
 *
 * リカバリコードは「使用済みの履歴」を残す設計だが、**解除時は消す** —
 * 残しておくと次に有効化したときに古い(既に本人の手元にない)コードが混ざるため。
 */
export async function deleteUserTotp(db: Database | Transaction, params: { tenantId: string; userId: string }): Promise<void> {
  await db
    .delete(userTotpRecoveryCodes)
    .where(and(eq(userTotpRecoveryCodes.tenantId, params.tenantId), eq(userTotpRecoveryCodes.userId, params.userId)));
  await db.delete(userTotp).where(and(eq(userTotp.tenantId, params.tenantId), eq(userTotp.userId, params.userId)));
}

/**
 * リカバリコードを入れ替える(既存を全削除して新しいハッシュ群を入れる)。
 * 有効化時と再生成時の両方で使う。使用済みの行も消える(= 古いコードは一切残らない)。
 */
export async function replaceRecoveryCodes(
  db: Database | Transaction,
  params: { tenantId: string; userId: string; codeHashes: string[]; createdAt: number },
): Promise<void> {
  await db
    .delete(userTotpRecoveryCodes)
    .where(and(eq(userTotpRecoveryCodes.tenantId, params.tenantId), eq(userTotpRecoveryCodes.userId, params.userId)));
  if (params.codeHashes.length === 0) return;
  await db.insert(userTotpRecoveryCodes).values(
    params.codeHashes.map((codeHash) => ({
      id: uuidv7(),
      tenantId: params.tenantId,
      userId: params.userId,
      codeHash,
      consumedAt: null,
      createdAt: params.createdAt,
    })),
  );
}

/** 未使用のリカバリコードの残数。設定画面に出す。 */
export async function countUnusedRecoveryCodes(db: Database, params: { tenantId: string; userId: string }): Promise<number> {
  const rows = await db
    .select()
    .from(userTotpRecoveryCodes)
    .where(
      and(
        eq(userTotpRecoveryCodes.tenantId, params.tenantId),
        eq(userTotpRecoveryCodes.userId, params.userId),
        isNull(userTotpRecoveryCodes.consumedAt),
      ),
    );
  return rows.length;
}

/**
 * リカバリコードを1本消費する。ハッシュ一致かつ未使用の行があれば consumed_at を立てて true。
 *
 * 判断点(単回使用の担保): UPDATE の WHERE に `consumed_at IS NULL` を含め、更新できた行数で
 * 成否を判定する。SELECT してから UPDATE すると、同じコードの同時送信で2回通りうる。
 */
export async function consumeRecoveryCode(
  db: Database | Transaction,
  params: { tenantId: string; userId: string; codeHash: string; consumedAt: number },
): Promise<boolean> {
  const updated = await db
    .update(userTotpRecoveryCodes)
    .set({ consumedAt: params.consumedAt })
    .where(
      and(
        eq(userTotpRecoveryCodes.tenantId, params.tenantId),
        eq(userTotpRecoveryCodes.userId, params.userId),
        eq(userTotpRecoveryCodes.codeHash, params.codeHash),
        isNull(userTotpRecoveryCodes.consumedAt),
      ),
    )
    .returning();
  return updated.length > 0;
}

/** テナント内で 2FA を有効化済みのユーザーIDの集合(メンバー一覧のバッジ表示用)。 */
export async function listTenantTotpEnabledUserIds(db: Database, tenantId: string): Promise<Set<string>> {
  const rows = await db.select().from(userTotp).where(eq(userTotp.tenantId, tenantId));
  return new Set(rows.filter((row) => row.enabledAt !== null).map((row) => row.userId));
}
