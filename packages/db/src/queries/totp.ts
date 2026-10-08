/**
 * user_totp / user_totp_recovery_codes のクエリ層(二要素認証、2026-08-27)。
 * 設計判断は packages/db/src/schema/totp.ts と docs/design/two-factor-auth.md を参照。
 *
 * このレイヤは **暗号処理を一切知らない**(共有鍵は "enc:v1:..." の文字列として受け渡すだけ、
 * リカバリコードは SHA-256 hex として受け渡すだけ)。暗号化・ハッシュ化は apps/api の責務
 * (packages/db は他の秘密情報カラムでも同じ分担にしてある — schema/oidc.ts 参照)。
 */

import { and, eq, isNull } from "drizzle-orm";
import { AtomicPlan, chunkRowsForInsert, runAtomic, type AtomicExecutor } from "../atomic.js";
import type { Database, Transaction } from "../types.js";
import { userTotp, userTotpRecoveryCodes } from "../schema/index.js";
import { uuidv7 } from "../uuid.js";
import { auditLogInsertQuery, type NewAuditLogInput } from "./audit.js";
import { notificationInsertIfAbsentQuery, type NewNotificationInput } from "./notifications.js";

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
  for (const statement of deleteUserTotpQueries(db, params)) await statement;
}

/** deleteUserTotp と同じ delete ビルダ2本(リカバリコード → TOTP 行)を返す(実行しない。atomic plan 用)。 */
function deleteUserTotpQueries(q: AtomicExecutor, params: { tenantId: string; userId: string }) {
  return [
    q
      .delete(userTotpRecoveryCodes)
      .where(and(eq(userTotpRecoveryCodes.tenantId, params.tenantId), eq(userTotpRecoveryCodes.userId, params.userId))),
    q.delete(userTotp).where(and(eq(userTotp.tenantId, params.tenantId), eq(userTotp.userId, params.userId))),
  ] as const;
}

/**
 * リカバリコードを入れ替える(既存を全削除して新しいハッシュ群を入れる)。
 * 有効化時と再生成時の両方で使う。使用済みの行も消える(= 古いコードは一切残らない)。
 * 単独では1単位にならない(呼び出し側のトランザクションに乗せる用)。API の有効化・再生成は
 * atomic plan 版の `enableUserTotpWithRecoveryCodes` / `regenerateRecoveryCodes` を使う。
 */
export async function replaceRecoveryCodes(
  db: Database | Transaction,
  params: { tenantId: string; userId: string; codeHashes: string[]; createdAt: number },
): Promise<void> {
  await db
    .delete(userTotpRecoveryCodes)
    .where(and(eq(userTotpRecoveryCodes.tenantId, params.tenantId), eq(userTotpRecoveryCodes.userId, params.userId)));
  for (const chunk of chunkRowsForInsert(userTotpRecoveryCodes, recoveryCodeRows(params))) {
    await db.insert(userTotpRecoveryCodes).values(chunk);
  }
}

function recoveryCodeRows(params: { tenantId: string; userId: string; codeHashes: string[]; createdAt: number }) {
  return params.codeHashes.map((codeHash) => ({
    id: uuidv7(),
    tenantId: params.tenantId,
    userId: params.userId,
    codeHash,
    consumedAt: null,
    createdAt: params.createdAt,
  }));
}

/**
 * リカバリコードの入れ替え(全削除 → 挿入)を計画に積む。挿入は D1 のバインド変数上限
 * (1文 100 個)に収まるよう `chunkRowsForInsert` で割る(6 列 → 16 行で1文。通常は 10 本で1文)。
 */
function addReplaceRecoveryCodes(
  plan: AtomicPlan,
  params: { tenantId: string; userId: string; codeHashes: string[]; createdAt: number },
): void {
  plan.add((q) =>
    q
      .delete(userTotpRecoveryCodes)
      .where(and(eq(userTotpRecoveryCodes.tenantId, params.tenantId), eq(userTotpRecoveryCodes.userId, params.userId))),
  );
  for (const chunk of chunkRowsForInsert(userTotpRecoveryCodes, recoveryCodeRows(params))) {
    plan.add((q) => q.insert(userTotpRecoveryCodes).values(chunk));
  }
}

export interface EnableUserTotpWithRecoveryCodesInput {
  tenantId: string;
  userId: string;
  /** UTC エポック分。enabled_at・リカバリコードの created_at・監査ログの occurred_at に使う */
  enabledAt: number;
  /** 確認に使ったコードのカウンタ(以後のリプレイ防止の基準) */
  lastUsedCounter: number;
  /** 新しいリカバリコードの SHA-256 hex */
  codeHashes: string[];
}

/**
 * 2FA の有効化(POST /auth/totp/enable): セットアップ中の行の有効化・リカバリコードの置き換え・
 * 監査ログ `auth.totp.enable` を1単位で書く(src/atomic.ts の atomic plan。D1 でも動く)。
 * 有効化できなかった(セットアップ中の行が無い・既に有効)ときは何も書かずに false。
 *
 * 判断点(2026-10-08、D1 対応。docs/design/d1-atomic-writes.md #20): 監査表では A(分岐なし)だったが、
 * 有効化の UPDATE に `enabled_at IS NULL` を足して claim にし、ガード `totp.enable` を置いた。
 * 従来は同じコードでの同時の有効化が両方通り、後から書いた側のリカバリコードだけが残る
 * (先に返った応答のコードは使えない — 本人が気づかないまま締め出されうる)ことがあった。
 * claim にすれば負けた側は何も書かず、呼び出し側が 409 を返せる。同時でない限り挙動は従来と同じ
 * (呼び出し側が事前に enabledAt を見て 409 already_enabled を返している)。
 */
export async function enableUserTotpWithRecoveryCodes(db: Database, input: EnableUserTotpWithRecoveryCodesInput): Promise<boolean> {
  const plan = new AtomicPlan();
  plan.add((q) =>
    q
      .update(userTotp)
      .set({ enabledAt: input.enabledAt, lastUsedCounter: input.lastUsedCounter })
      .where(and(eq(userTotp.tenantId, input.tenantId), eq(userTotp.userId, input.userId), isNull(userTotp.enabledAt)))
      .returning({ userId: userTotp.userId }),
  );
  plan.guard("totp.enable");
  addReplaceRecoveryCodes(plan, {
    tenantId: input.tenantId,
    userId: input.userId,
    codeHashes: input.codeHashes,
    createdAt: input.enabledAt,
  });
  plan.add((q) =>
    auditLogInsertQuery(q, {
      tenantId: input.tenantId,
      actorId: input.userId,
      action: "auth.totp.enable",
      targetType: "users",
      targetId: input.userId,
      detail: JSON.stringify({}),
      occurredAt: input.enabledAt,
    }),
  );
  const result = await runAtomic(db, plan);
  return result.ok;
}

/**
 * リカバリコードの再生成(POST /auth/totp/recovery-codes): 置き換えと監査ログ
 * `auth.totp.recovery_codes.regenerate` を1単位で書く(atomic plan。分岐なし — 監査表 #22)。
 */
export async function regenerateRecoveryCodes(
  db: Database,
  input: { tenantId: string; userId: string; codeHashes: string[]; createdAt: number },
): Promise<void> {
  const plan = new AtomicPlan();
  addReplaceRecoveryCodes(plan, input);
  plan.add((q) =>
    auditLogInsertQuery(q, {
      tenantId: input.tenantId,
      actorId: input.userId,
      action: "auth.totp.recovery_codes.regenerate",
      targetType: "users",
      targetId: input.userId,
      detail: JSON.stringify({}),
      occurredAt: input.createdAt,
    }),
  );
  await runAtomic(db, plan);
}

export interface RemoveUserTotpInput {
  tenantId: string;
  userId: string;
  /** 一緒に書く監査ログ(本人の無効化は `auth.totp.disable`、管理者のリセットは `member.totp.reset`) */
  audit: NewAuditLogInput;
  /** 一緒に作る本人宛の通知(管理者のリセットのみ)。同じキーの通知が既にあれば作らない */
  notification?: NewNotificationInput;
}

/**
 * 2FA の解除(本人の無効化 POST /auth/totp/disable と、管理者のリセット
 * POST /members/:id/two-factor/reset): TOTP 行とリカバリコードの削除・監査ログ・(あれば)通知を
 * 1単位で書く(atomic plan。分岐なし — 監査表 #21・#25)。
 *
 * 通知は `createNotificationIfAbsent` と同じく、UNIQUE(tenant_id, user_id, type, subject_date) が
 * 既にあれば何もしない(`ON CONFLICT DO NOTHING`。計画の中で例外を捕まえられないため、
 * 「違反を捕捉して null」を SQL 側の握りつぶしに置き換えた)。
 */
export async function removeUserTotp(db: Database, input: RemoveUserTotpInput): Promise<void> {
  const plan = new AtomicPlan();
  plan.add((q) => deleteUserTotpQueries(q, input)[0]);
  plan.add((q) => deleteUserTotpQueries(q, input)[1]);
  plan.add((q) => auditLogInsertQuery(q, input.audit));
  const notification = input.notification;
  if (notification !== undefined) plan.add((q) => notificationInsertIfAbsentQuery(q, notification));
  await runAtomic(db, plan);
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
