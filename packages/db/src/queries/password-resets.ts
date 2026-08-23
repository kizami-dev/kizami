/**
 * password_reset_tokens に対するクエリ層(管理者発行パスワードリセット、Tier 0)。
 * スキーマ側の設計判断は packages/db/src/schema/password-resets.ts を参照。
 *
 * invitations(packages/db/src/queries/invitations.ts)と同型の作法をそのまま踏襲する:
 * - createPasswordResetToken: 発行。既存の「未決着」トークン(未使用・未失効)を revoke して
 *   から新規作成する(1トランザクション)。invitations.createInvitation と同じ不変条件
 *   (未決着はテナント内ユーザーごとに高々1本)を採用した
 * - findPasswordResetTokenByHash: 使用(POST /password-resets/:token/use)用。行を返すだけで
 *   有効性(期限・失効・使用済み)判定は呼び出し側(apps/api/src/routes/password-resets.ts)の
 *   責務とする(404 と 410 を使い分けるため、ここで判定を握りつぶさない)
 * - getLatestPasswordResetTokenForUser: あるユーザーの最新のリセットトークン(作成日時降順の
 *   先頭1件)。DELETE /members/:id/password-resets(取り消し対象の特定)に使う
 * - listPasswordResetTokensForTenant: テナント全トークンを作成日時降順で返す。呼び出し側
 *   (apps/api/src/routes/members.ts の GET /)は listInvitationsForTenant と同じ規約で、
 *   同一 userId が複数出現した場合は先頭(最新)のみを採用すること
 * - usePasswordResetToken: 使用。有効性の再検証・auth_credentials の UPDATE・当該ユーザーの
 *   全セッション revoke・監査ログ追記を1トランザクションで行う。UPDATE の WHERE 句に
 *   isNull(usedAt)/isNull(revokedAt) を含めることで、有効性の再検証と更新の間に別リクエストが
 *   割り込む TOCTOU を防ぐ(acceptInvitation と同じ方式)
 * - revokePasswordResetToken: 管理者による取り消し(DELETE /members/:id/password-resets)。
 *   使用済み・失効済みは対象外(0件更新でnull)
 * - revokeAllPasswordResetTokensForUser: 退職処理(無効化)からの一括 revoke。特定の1本を
 *   探し当てる必要がなく(未決着は高々1本という不変条件により)、WHERE 句のみで冪等に効く
 */

import { and, desc, eq, isNull } from "drizzle-orm";
import type { Database, Transaction } from "../migrate.js";
import { authCredentials, passwordResetTokens } from "../schema/index.js";
import { uuidv7 } from "../uuid.js";
import { insertAuditLog } from "./audit.js";
import { revokeAllSessionsForUser } from "./sessions.js";

export type PasswordResetToken = typeof passwordResetTokens.$inferSelect;

export interface NewPasswordResetTokenInput {
  tenantId: string;
  userId: string;
  /** トークンの SHA-256(hex)。平文はここでは受け取らない(呼び出し側が生成・表示済み) */
  tokenHash: string;
  /** UTC エポック分 */
  expiresAt: number;
  createdBy: string;
  createdAt: number;
}

/**
 * 既存の未決着リセットトークンを revoke してから新規発行する本体(invitations.ts の
 * revokeAndCreateInvitation と同じ構造)。
 */
async function revokeAndCreatePasswordResetToken(
  db: Database | Transaction,
  input: NewPasswordResetTokenInput,
): Promise<PasswordResetToken> {
  await db
    .update(passwordResetTokens)
    .set({ revokedAt: input.createdAt })
    .where(
      and(
        eq(passwordResetTokens.tenantId, input.tenantId),
        eq(passwordResetTokens.userId, input.userId),
        isNull(passwordResetTokens.usedAt),
        isNull(passwordResetTokens.revokedAt),
      ),
    );

  const [row] = await db
    .insert(passwordResetTokens)
    .values({
      id: uuidv7(),
      tenantId: input.tenantId,
      userId: input.userId,
      tokenHash: input.tokenHash,
      expiresAt: input.expiresAt,
      usedAt: null,
      revokedAt: null,
      createdBy: input.createdBy,
      createdAt: input.createdAt,
    })
    .returning();
  if (!row) {
    throw new Error("createPasswordResetToken: insert returned no row");
  }
  return row;
}

/** password_reset_tokens へ1件発行する(既存の未決着トークンを revoke してから作成、1トランザクション)。 */
export async function createPasswordResetToken(db: Database, input: NewPasswordResetTokenInput): Promise<PasswordResetToken> {
  return db.transaction((tx) => revokeAndCreatePasswordResetToken(tx, input));
}

/** トークンのハッシュから1件探す(使用用)。有効性の判定は呼び出し側が行う。 */
export async function findPasswordResetTokenByHash(db: Database, tokenHash: string): Promise<PasswordResetToken | null> {
  const rows = await db.select().from(passwordResetTokens).where(eq(passwordResetTokens.tokenHash, tokenHash)).limit(1);
  return rows[0] ?? null;
}

/** あるユーザーの最新のリセットトークン(作成日時降順の先頭1件)。一度も発行されていなければ null。 */
export async function getLatestPasswordResetTokenForUser(
  db: Database,
  params: { tenantId: string; userId: string },
): Promise<PasswordResetToken | null> {
  const rows = await db
    .select()
    .from(passwordResetTokens)
    .where(and(eq(passwordResetTokens.tenantId, params.tenantId), eq(passwordResetTokens.userId, params.userId)))
    // createdAt は分単位のため同一分内の再発行では並びが決まらない。id(uuidv7、単調)を
    // タイブレークに使う(invitations.ts の getLatestInvitationForUser と同じ理由・同じ方式)。
    .orderBy(desc(passwordResetTokens.createdAt), desc(passwordResetTokens.id))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * テナント全リセットトークンを作成日時降順で返す(メンバー一覧のバッジ表示用)。
 * 同一 userId が複数出現し得るため、呼び出し側は先頭(最新)のみを採用すること。
 */
export async function listPasswordResetTokensForTenant(db: Database, tenantId: string): Promise<PasswordResetToken[]> {
  return db
    .select()
    .from(passwordResetTokens)
    .where(eq(passwordResetTokens.tenantId, tenantId))
    .orderBy(desc(passwordResetTokens.createdAt), desc(passwordResetTokens.id));
}

export interface UsePasswordResetTokenInput {
  tokenHash: string;
  /** ハッシュ化済みパスワード(apps/api/src/auth/password.ts の hashPassword 済み) */
  passwordHash: string;
  /** UTC エポック分 */
  nowMinutes: number;
}

export interface UsedPasswordResetToken {
  passwordResetToken: PasswordResetToken;
  tenantId: string;
  userId: string;
}

/**
 * リセットトークンを使用する: 有効性の再検証・used_at 設定・auth_credentials の UPDATE・
 * 当該ユーザーの全セッション revoke・監査ログ追記を1トランザクションで行う。失敗(存在しない・
 * 失効済み・使用済み・期限切れ)は null を返す — 理由の切り分け(404 vs 410)は呼び出し側
 * (apps/api/src/routes/password-resets.ts)がトークン探索時に別途行う(invitations.ts の
 * acceptInvitation と同じ役割分担)。
 *
 * セッション発行(createSession)はこの関数の外側・別トランザクションのまま(呼び出し側が行う)。
 * パスワード更新自体(このトランザクション)とログイン状態にすることは別の関心事であり、後者が
 * 失敗してもパスワード自体は更新済みであるべきなので、acceptInvitation と同じくあえて分離する。
 */
export async function usePasswordResetToken(db: Database, input: UsePasswordResetTokenInput): Promise<UsedPasswordResetToken | null> {
  return db.transaction(async (tx) => {
    const rows = await tx.select().from(passwordResetTokens).where(eq(passwordResetTokens.tokenHash, input.tokenHash)).limit(1);
    const token = rows[0];
    if (!token) return null;
    if (token.revokedAt !== null || token.usedAt !== null || token.expiresAt <= input.nowMinutes) {
      return null;
    }

    // WHERE に isNull(usedAt)/isNull(revokedAt) を再度含めることで、直前の SELECT からここまでの
    // 間に別リクエストが先に使用・失効させていた場合(TOCTOU)を検出する。
    const [updated] = await tx
      .update(passwordResetTokens)
      .set({ usedAt: input.nowMinutes })
      .where(and(eq(passwordResetTokens.id, token.id), isNull(passwordResetTokens.usedAt), isNull(passwordResetTokens.revokedAt)))
      .returning();
    if (!updated) return null;

    // 対象は「受諾済み(auth_credentials あり)」のユーザーのみのはず(発行時に呼び出し側が
    // 検証済み)。無ければトランザクションごと失敗させる(acceptInvitation の insert 失敗時と
    // 同じ「起きてはいけない不変条件違反は握りつぶさず例外にする」方針)。
    const [cred] = await tx
      .update(authCredentials)
      .set({ passwordHash: input.passwordHash, updatedAt: input.nowMinutes })
      .where(and(eq(authCredentials.tenantId, token.tenantId), eq(authCredentials.userId, token.userId)))
      .returning();
    if (!cred) {
      throw new Error("usePasswordResetToken: auth_credentials not found for user");
    }

    // パスワードを変えた = 旧資格情報の疑いがあるため、当該ユーザーの全セッションを失効させる。
    await revokeAllSessionsForUser(tx, { tenantId: token.tenantId, userId: token.userId, revokedAt: input.nowMinutes });

    await insertAuditLog(tx, {
      tenantId: token.tenantId,
      actorId: token.userId,
      action: "password_reset.use",
      targetType: "user",
      targetId: token.userId,
      detail: JSON.stringify({}),
      occurredAt: input.nowMinutes,
    });

    return { passwordResetToken: updated, tenantId: token.tenantId, userId: token.userId };
  });
}

export interface RevokePasswordResetTokenParams {
  tenantId: string;
  id: string;
  /** UTC エポック分 */
  revokedAt: number;
}

/** 取り消す(行は消さず revoked_at を立てる)。使用済み・失効済みは対象外(0件更新でnull)。 */
export async function revokePasswordResetToken(
  db: Database | Transaction,
  params: RevokePasswordResetTokenParams,
): Promise<PasswordResetToken | null> {
  const [row] = await db
    .update(passwordResetTokens)
    .set({ revokedAt: params.revokedAt })
    .where(
      and(
        eq(passwordResetTokens.tenantId, params.tenantId),
        eq(passwordResetTokens.id, params.id),
        isNull(passwordResetTokens.usedAt),
        isNull(passwordResetTokens.revokedAt),
      ),
    )
    .returning();
  return row ?? null;
}

/**
 * 対象ユーザーの未決着(未使用・未失効)リセットトークンがあれば一括 revoke する(退職処理用)。
 * 「未決着は高々1本」の不変条件により対象を1本ずつ特定する必要がなく、WHERE 句のみで冪等に効く
 * (0件でもエラーにならない)。
 */
export async function revokeAllPasswordResetTokensForUser(
  db: Database | Transaction,
  params: { tenantId: string; userId: string; revokedAt: number },
): Promise<void> {
  await db
    .update(passwordResetTokens)
    .set({ revokedAt: params.revokedAt })
    .where(
      and(
        eq(passwordResetTokens.tenantId, params.tenantId),
        eq(passwordResetTokens.userId, params.userId),
        isNull(passwordResetTokens.usedAt),
        isNull(passwordResetTokens.revokedAt),
      ),
    );
}
