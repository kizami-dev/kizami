/**
 * invitations に対するクエリ層(メンバー招待式登録、docs/requirements.md §認証)。
 *
 * - createInvitation: 発行。既存の「未決着」招待(未受諾・未失効。期限切れでも決着していなければ
 *   含む)を revoke してから新規作成する(1トランザクション)。「有効(期限内)なものだけ」を
 *   都度計算するより「未決着は必ずテナント内ユーザーごとに高々1本」という不変条件のほうが
 *   単純で見通しがよいと判断した(schema/invitations.ts の部分UNIQUEを使わない判断点と対）
 * - findInvitationByTokenHash: 受諾用。行を返すだけで有効性(期限・失効・受諾済み)判定は
 *   呼び出し側(apps/api/src/routes/invitations.ts)の責務とする(404 と 410 を使い分けるため、
 *   ここで判定を握りつぶさない)
 * - getLatestInvitationForUser: あるユーザーの最新の招待(作成日時降順の先頭1件)
 * - listInvitationsForTenant: テナント全招待を作成日時降順で返す。呼び出し側
 *   (routes/members.ts)は listTenantMembershipsWithDepartment と同じ規約で、
 *   同一 userId が複数出現した場合は先頭(最新)のみを採用すること
 * - acceptInvitation: 受諾。accepted_at 設定 + auth_credentials 作成を1トランザクションで行う。
 *   UPDATE の WHERE 句に isNull(acceptedAt)/isNull(revokedAt) を含めることで、有効性の再検証と
 *   更新の間に別リクエストが割り込む TOCTOU を防ぐ(同時受諾は後勝ちが0件更新でnullになる)
 * - revokeInvitation: 取り消し。受諾済み・失効済みは対象外(0件更新でnull)
 * - userHasCredential / listTenantUserIdsWithCredentials: 「受諾済み(active)」の判定
 *   (auth_credentials の有無そのものが受諾済みの定義、docs/requirements.md §認証)
 */

import { and, desc, eq, isNull } from "drizzle-orm";
import type { Database, Transaction } from "../migrate.js";
import { authCredentials, invitations } from "../schema/index.js";
import { uuidv7 } from "../uuid.js";

export type Invitation = typeof invitations.$inferSelect;

export interface NewInvitationInput {
  tenantId: string;
  userId: string;
  /** トークンの SHA-256(hex)。平文はここでは受け取らない(呼び出し側が生成・表示済み) */
  tokenHash: string;
  /** UTC エポック分 */
  expiresAt: number;
  createdBy: string;
  createdAt: number;
}

/** invitations へ1件発行する(既存の未決着招待を revoke してから作成、1トランザクション)。 */
export async function createInvitation(db: Database, input: NewInvitationInput): Promise<Invitation> {
  return db.transaction(async (tx) => {
    await tx
      .update(invitations)
      .set({ revokedAt: input.createdAt })
      .where(
        and(
          eq(invitations.tenantId, input.tenantId),
          eq(invitations.userId, input.userId),
          isNull(invitations.acceptedAt),
          isNull(invitations.revokedAt),
        ),
      );

    const [row] = await tx
      .insert(invitations)
      .values({
        id: uuidv7(),
        tenantId: input.tenantId,
        userId: input.userId,
        tokenHash: input.tokenHash,
        expiresAt: input.expiresAt,
        acceptedAt: null,
        revokedAt: null,
        createdBy: input.createdBy,
        createdAt: input.createdAt,
      })
      .returning();
    if (!row) {
      throw new Error("createInvitation: insert returned no row");
    }
    return row;
  });
}

/** トークンのハッシュから1件探す(受諾用)。有効性の判定は呼び出し側が行う。 */
export async function findInvitationByTokenHash(db: Database, tokenHash: string): Promise<Invitation | null> {
  const rows = await db.select().from(invitations).where(eq(invitations.tokenHash, tokenHash)).limit(1);
  return rows[0] ?? null;
}

/** あるユーザーの最新の招待(作成日時降順の先頭1件)。招待が一度も無ければ null。 */
export async function getLatestInvitationForUser(
  db: Database,
  params: { tenantId: string; userId: string },
): Promise<Invitation | null> {
  const rows = await db
    .select()
    .from(invitations)
    .where(and(eq(invitations.tenantId, params.tenantId), eq(invitations.userId, params.userId)))
    // createdAt は分単位(nowMinutes)のため、同一分内の再発行では並びが決まらず
    // 「最新の招待」の解決が行順まかせになる(招待作成→即再発行で実際に発生し、
    // バッジが誤って期限切れ表示になった)。id は uuidv7 で同一ミリ秒内も単調のため、
    // タイブレークに使えば発行順が確定する(2026-08-23)。
    .orderBy(desc(invitations.createdAt), desc(invitations.id))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * テナント全招待を作成日時降順で返す(メンバー一覧の招待状態表示用)。
 * 同一 userId が複数出現し得るため、呼び出し側は先頭(最新)のみを採用すること
 * (packages/db/src/queries/members.ts の listTenantMembershipsWithDepartment と同じ規約)。
 */
export async function listInvitationsForTenant(db: Database, tenantId: string): Promise<Invitation[]> {
  return db.select().from(invitations).where(eq(invitations.tenantId, tenantId)).orderBy(desc(invitations.createdAt), desc(invitations.id));
}

export interface AcceptInvitationInput {
  tokenHash: string;
  /** ハッシュ化済みパスワード(apps/api/src/auth/password.ts の hashPassword 済み) */
  passwordHash: string;
  /** UTC エポック分 */
  nowMinutes: number;
}

export interface AcceptedInvitation {
  invitation: Invitation;
  tenantId: string;
  userId: string;
}

/**
 * 招待を受諾する: 有効性の再検証・accepted_at 設定・auth_credentials 作成を1トランザクションで行う。
 * 失敗(存在しない・失効済み・受諾済み・期限切れ)は null を返す — 理由の切り分け(404 vs 410)は
 * 呼び出し側(apps/api/src/routes/invitations.ts)がトークン探索時に別途行う。
 */
export async function acceptInvitation(db: Database, input: AcceptInvitationInput): Promise<AcceptedInvitation | null> {
  return db.transaction(async (tx) => {
    const rows = await tx.select().from(invitations).where(eq(invitations.tokenHash, input.tokenHash)).limit(1);
    const invitation = rows[0];
    if (!invitation) return null;
    if (invitation.revokedAt !== null || invitation.acceptedAt !== null || invitation.expiresAt <= input.nowMinutes) {
      return null;
    }

    // WHERE に isNull(acceptedAt)/isNull(revokedAt) を再度含めることで、直前の SELECT から
    // ここまでの間に別リクエストが先に受諾・失効させていた場合(TOCTOU)を検出する。
    const [updated] = await tx
      .update(invitations)
      .set({ acceptedAt: input.nowMinutes })
      .where(and(eq(invitations.id, invitation.id), isNull(invitations.acceptedAt), isNull(invitations.revokedAt)))
      .returning();
    if (!updated) return null;

    const [cred] = await tx
      .insert(authCredentials)
      .values({
        id: uuidv7(),
        tenantId: invitation.tenantId,
        userId: invitation.userId,
        passwordHash: input.passwordHash,
        createdAt: input.nowMinutes,
        updatedAt: input.nowMinutes,
      })
      .returning();
    if (!cred) {
      throw new Error("acceptInvitation: auth_credentials insert returned no row");
    }

    return { invitation: updated, tenantId: invitation.tenantId, userId: invitation.userId };
  });
}

export interface RevokeInvitationParams {
  tenantId: string;
  id: string;
  /** UTC エポック分 */
  revokedAt: number;
}

/** 取り消す(行は消さず revoked_at を立てる)。受諾済み・失効済みは対象外(0件更新でnull)。 */
export async function revokeInvitation(db: Database | Transaction, params: RevokeInvitationParams): Promise<Invitation | null> {
  const [row] = await db
    .update(invitations)
    .set({ revokedAt: params.revokedAt })
    .where(
      and(
        eq(invitations.tenantId, params.tenantId),
        eq(invitations.id, params.id),
        isNull(invitations.acceptedAt),
        isNull(invitations.revokedAt),
      ),
    )
    .returning();
  return row ?? null;
}

/** そのユーザーが auth_credentials を持つか(= 受諾済み/active か)。 */
export async function userHasCredential(db: Database, params: { tenantId: string; userId: string }): Promise<boolean> {
  const rows = await db
    .select({ id: authCredentials.id })
    .from(authCredentials)
    .where(and(eq(authCredentials.tenantId, params.tenantId), eq(authCredentials.userId, params.userId)))
    .limit(1);
  return rows.length > 0;
}

/** テナント内で auth_credentials を持つ(= 受諾済み/active な)ユーザーID集合。一覧表示用。 */
export async function listTenantUserIdsWithCredentials(db: Database, tenantId: string): Promise<Set<string>> {
  const rows = await db
    .select({ userId: authCredentials.userId })
    .from(authCredentials)
    .where(eq(authCredentials.tenantId, tenantId));
  return new Set(rows.map((r) => r.userId));
}
