/**
 * password_reset_tokens に対するクエリ層(管理者発行パスワードリセット、Tier 0)。
 * スキーマ側の設計判断は packages/db/src/schema/password-resets.ts を参照。
 *
 * invitations(packages/db/src/queries/invitations.ts)と同型の作法をそのまま踏襲する:
 * - createPasswordResetToken: 発行。既存の「未決着」トークン(未使用・未失効)を revoke して
 *   から新規作成する(1単位 — src/atomic.ts の atomic plan。D1 でも動く)。invitations.createInvitation
 *   と同じ不変条件(未決着はテナント内ユーザーごとに高々1本)を採用した
 * - findPasswordResetTokenByHash: 使用(POST /password-resets/:token/use)用。行を返すだけで
 *   有効性(期限・失効・使用済み)判定は呼び出し側(apps/api/src/routes/password-resets.ts)の
 *   責務とする(404 と 410 を使い分けるため、ここで判定を握りつぶさない)
 * - getLatestPasswordResetTokenForUser: あるユーザーの最新のリセットトークン(作成日時降順の
 *   先頭1件)。DELETE /members/:id/password-resets(取り消し対象の特定)に使う
 * - listPasswordResetTokensForTenant: テナント全トークンを作成日時降順で返す。呼び出し側
 *   (apps/api/src/routes/members.ts の GET /)は listInvitationsForTenant と同じ規約で、
 *   同一 userId が複数出現した場合は先頭(最新)のみを採用すること
 * - usePasswordResetToken: 使用。有効性の再検証・auth_credentials の UPDATE・当該ユーザーの
 *   全セッション revoke・他トークンの失効・監査ログ追記を1単位で行う(atomic plan。D1 でも動く)。
 *   UPDATE の WHERE 句に isNull(usedAt)/isNull(revokedAt)/期限を含めることで、有効性の再検証と
 *   更新の間に別リクエストが割り込む TOCTOU を防ぐ(acceptInvitation と同じ方式。負けた側は
 *   ガードで計画ごと失敗し、パスワードもセッションも監査ログも書かれない)
 * - revokePasswordResetToken: 管理者による取り消し(DELETE /members/:id/password-resets)。
 *   使用済み・失効済みは対象外(0件更新でnull)
 * - revokeAllPasswordResetTokensForUser: 退職処理(無効化)からの一括 revoke。特定の1本を
 *   探し当てる必要がなく(未決着は高々1本という不変条件により)、WHERE 句のみで冪等に効く
 */

import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { AtomicPlan, runAtomic, type AtomicExecutor } from "../atomic.js";
import type { Database, Transaction } from "../types.js";
import { authCredentials, passwordResetTokens } from "../schema/index.js";
import { uuidv7 } from "../uuid.js";
import { auditLogInsertQuery } from "./audit.js";
import { revokeAllSessionsForUserQuery } from "./sessions.js";

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

/** 既存の未決着リセットトークン(発行経路を問わない)を revoke する update ビルダ(実行しない)。 */
function revokePendingPasswordResetTokensQuery(q: AtomicExecutor, input: NewPasswordResetTokenInput) {
  return revokeAllPasswordResetTokensForUserQuery(q, { tenantId: input.tenantId, userId: input.userId, revokedAt: input.createdAt });
}

/** 管理者発行のリセットトークンを1件作る insert ビルダ(実行しない)。 */
function insertPasswordResetTokenQuery(q: AtomicExecutor, input: NewPasswordResetTokenInput) {
  return q
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
}

/**
 * password_reset_tokens へ1件発行する(既存の未決着トークンを revoke してから作成、1単位)。
 *
 * 判断点(2026-10-08、D1 対応。docs/design/d1-atomic-writes.md #3): revoke と insert はどちらも
 * 無条件の書き込みで途中の結果で分岐しないので、atomic plan へそのまま積む(ガード不要。
 * invitations.createInvitation と同形)。
 */
export async function createPasswordResetToken(db: Database, input: NewPasswordResetTokenInput): Promise<PasswordResetToken> {
  const plan = new AtomicPlan();
  plan.add((q) => revokePendingPasswordResetTokensQuery(q, input));
  const inserted = plan.add((q) => insertPasswordResetTokenQuery(q, input));
  const result = await runAtomic(db, plan);
  // ガードを積んでいないので ok: false にはならない
  const row = result.ok ? result.get(inserted)[0] : undefined;
  if (!row) {
    throw new Error("createPasswordResetToken: insert returned no row");
  }
  return row;
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
 * 当該ユーザーの全セッション revoke・他トークンの失効・監査ログ追記を1単位で行う。失敗(存在しない・
 * 失効済み・使用済み・期限切れ)は null を返す — 理由の切り分け(404 vs 410)は呼び出し側
 * (apps/api/src/routes/password-resets.ts)がトークン探索時に別途行う(invitations.ts の
 * acceptInvitation と同じ役割分担)。
 *
 * セッション発行(createSession)はこの関数の外側・別トランザクションのまま(呼び出し側が行う)。
 * パスワード更新自体(この計画)とログイン状態にすることは別の関心事であり、後者が
 * 失敗してもパスワード自体は更新済みであるべきなので、acceptInvitation と同じくあえて分離する。
 *
 * 判断点(2026-10-08、D1 対応。docs/design/d1-atomic-writes.md #4): 読み取り(トークン探索と
 * 有効性の事前判定)は計画の外へ出し、書き込みを atomic plan に次の順で積む:
 *
 * 1. トークンの claim(`used_at IS NULL AND revoked_at IS NULL AND expires_at > now` の条件付き UPDATE)
 *    → ガード `password_reset.claim`。0 行(同時の二重使用・使用直前の失効/取り消し)なら**何も書かない**
 *    で null。WHERE に期限も入れた(従来は事前判定だけ。事前判定と claim の間に期限を跨いだ要求を
 *    通さない — acceptInvitation と同じ条件の揃え方)
 * 2. 資格情報の UPDATE → ガード `password_reset.credential`。対象は受諾済みユーザーのはず(発行時に
 *    呼び出し側が検証済み)で、無ければ不変条件違反。従来どおり例外にする(トークンも消費しない —
 *    ガードで claim ごと巻き戻る)
 * 3. 全セッションの失効 → 4. 同じユーザーの他の未決着トークンの失効 → 5. 監査ログ
 *
 * ガードは計画全体を巻き戻すので、claim に負けた・資格情報が無い、のどちらでも
 * パスワード・セッション・他トークン・監査ログのいずれも書かれない(fail-closed)。
 */
export async function usePasswordResetToken(db: Database, input: UsePasswordResetTokenInput): Promise<UsedPasswordResetToken | null> {
  const rows = await db.select().from(passwordResetTokens).where(eq(passwordResetTokens.tokenHash, input.tokenHash)).limit(1);
  const token = rows[0];
  if (!token) return null;
  if (token.revokedAt !== null || token.usedAt !== null || token.expiresAt <= input.nowMinutes) {
    return null;
  }

  const plan = new AtomicPlan();
  // WHERE に isNull(usedAt)/isNull(revokedAt)/期限を再度含めることで、直前の SELECT からここまでの
  // 間に別リクエストが先に使用・失効させていた場合(TOCTOU)を検出する。
  const claim = plan.add((q) =>
    q
      .update(passwordResetTokens)
      .set({ usedAt: input.nowMinutes })
      .where(
        and(
          eq(passwordResetTokens.id, token.id),
          isNull(passwordResetTokens.usedAt),
          isNull(passwordResetTokens.revokedAt),
          gt(passwordResetTokens.expiresAt, input.nowMinutes),
        ),
      )
      .returning(),
  );
  plan.guard("password_reset.claim");

  plan.add((q) =>
    q
      .update(authCredentials)
      .set({ passwordHash: input.passwordHash, updatedAt: input.nowMinutes })
      .where(and(eq(authCredentials.tenantId, token.tenantId), eq(authCredentials.userId, token.userId)))
      .returning({ id: authCredentials.id }),
  );
  plan.guard("password_reset.credential");

  // パスワードを変えた = 旧資格情報の疑いがあるため、当該ユーザーの全セッションを失効させる。
  plan.add((q) => revokeAllSessionsForUserQuery(q, { tenantId: token.tenantId, userId: token.userId, revokedAt: input.nowMinutes }));

  // 同じユーザーの**ほかの未使用・未失効トークンもすべて失効**させる(発行経路 admin / self を問わない)。
  // 以前は管理者の再発行が古いトークンを全部失効させていたので有効なトークンは常に1本だったが、
  // 本人発行と管理者発行が並存しうるようになったため、使った1本以外が有効なまま残らないよう
  // ここで明示的に閉じる(used_at を立てた自分自身は、同じ計画の1文目で used_at が入っているので対象外)。
  plan.add((q) =>
    revokeAllPasswordResetTokensForUserQuery(q, { tenantId: token.tenantId, userId: token.userId, revokedAt: input.nowMinutes }),
  );

  plan.add((q) =>
    auditLogInsertQuery(q, {
      tenantId: token.tenantId,
      actorId: token.userId,
      action: "password_reset.use",
      targetType: "user",
      targetId: token.userId,
      // 発行経路(admin / self)を残す。本人用の再設定でも使用側の挙動は同一(全セッション失効)。
      detail: JSON.stringify({ source: token.source }),
      occurredAt: input.nowMinutes,
    }),
  );

  const result = await runAtomic(db, plan);
  if (!result.ok) {
    if (result.failedGuard === "password_reset.credential") {
      // acceptInvitation の insert 失敗時と同じ「起きてはいけない不変条件違反は握りつぶさず例外にする」方針
      throw new Error("usePasswordResetToken: auth_credentials not found for user");
    }
    return null;
  }
  const [updated] = result.get(claim);
  if (!updated) {
    // ガードを通った以上 claim は1行返している(ここに来たら atomic plan の不具合)
    throw new Error("usePasswordResetToken: claim returned no row after the guard passed");
  }
  return { passwordResetToken: updated, tenantId: token.tenantId, userId: token.userId };
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
  await revokeAllPasswordResetTokensForUserQuery(db, params);
}

/** revokeAllPasswordResetTokensForUser と同じ update ビルダを返す(実行しない。atomic plan 用)。 */
export function revokeAllPasswordResetTokensForUserQuery(
  db: Database | Transaction,
  params: { tenantId: string; userId: string; revokedAt: number },
) {
  return db
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
