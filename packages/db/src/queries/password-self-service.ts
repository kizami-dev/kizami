/**
 * パスワードの本人操作 2 系統のクエリ層(2026-10-04 追加)。
 *
 * 1. **ログイン中の本人によるパスワード変更**(`changeOwnPassword`): apps/api の
 *    POST /auth/password/change が使う。
 * 2. **「パスワードを忘れた」本人用の再設定**(未認証・システムメールがある配備のみ): apps/api の
 *    POST /password-resets/request が使う。トークンは管理者発行と同じ `password_reset_tokens` 表・
 *    同じ使用フロー(`usePasswordResetToken`)を流用し、`source = 'self'` で区別する。
 *    - `findSelfServiceResetTargetsByEmail`: メールからの対象探索(全テナント横断)
 *    - `acquirePasswordResetRequestSlot`: メール単位の再送スロットル(原子的)
 *    - `issueSelfServicePasswordResetToken`: 本人発行の古いトークンを失効 → 新規発行 → 監査ログ
 *
 * `password_reset_requests`(スロットル表)はテナントを持たないシステム表で、アクセス経路は
 * routes/password-resets.ts の本人用リセットだけに限る。
 */

import { and, asc, eq, isNull, sql } from "drizzle-orm";
import type { Database, Transaction } from "../types.js";
import { authCredentials, passwordResetRequests, passwordResetTokens, users } from "../schema/index.js";
import { uuidv7 } from "../uuid.js";
import { insertAuditLog } from "./audit.js";
import { revokeAllPasswordResetTokensForUser, type PasswordResetToken } from "./password-resets.js";
import { revokeOtherSessionsForUser } from "./sessions.js";

// ---- 1. ログイン中の本人によるパスワード変更 ----------------------------------

export interface ChangeOwnPasswordInput {
  tenantId: string;
  userId: string;
  /** ハッシュ化済みの新しいパスワード(apps/api/src/auth/password.ts の hashPassword 済み) */
  passwordHash: string;
  /** 残すセッション(今リクエストを送っているもの)。sessions.id = トークンの SHA-256 hex */
  currentSessionId: string;
  /** UTC エポック分 */
  nowMinutes: number;
}

/**
 * パスワードハッシュの更新・**今のセッション以外の全セッション失効**・監査ログ追記を
 * 1トランザクションで行う。資格情報の行が無ければ(SSO のみのユーザー等)何も書かずに false。
 *
 * 管理者リセット(`usePasswordResetToken`)は「旧資格情報が漏れている疑い」で全セッションを
 * 失効させるが、本人の変更は今のセッションの持ち主が操作しているので、それだけは残す。
 * API キーには触れない(人のログインとは別系統。判断は apps/api/src/routes/auth-password.ts 冒頭)。
 *
 * ## 再設定トークンの失効(auth-token-lifecycle)
 *
 * 再設定トークンは「どちらかが使われた時点」(`usePasswordResetToken`)と「本人がパスワードを変えた
 * 時点」(この関数)で、そのユーザーの未使用・未失効のトークンが**発行経路を問わず全部**失効する。
 * 一方、`issueSelfServicePasswordResetToken` が失効させるのは本人発行の古いものだけ(管理者が手渡した
 * リンクを「忘れた」の操作で殺さない)。
 */
export async function changeOwnPassword(db: Database, input: ChangeOwnPasswordInput): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [cred] = await tx
      .update(authCredentials)
      .set({ passwordHash: input.passwordHash, updatedAt: input.nowMinutes })
      .where(and(eq(authCredentials.tenantId, input.tenantId), eq(authCredentials.userId, input.userId)))
      .returning({ id: authCredentials.id });
    if (!cred) return false;

    await revokeOtherSessionsForUser(tx, {
      tenantId: input.tenantId,
      userId: input.userId,
      exceptSessionId: input.currentSessionId,
      revokedAt: input.nowMinutes,
    });

    // 未使用・未失効の再設定トークンも**本人発行・管理者発行を問わず全部失効**させる。乗っ取りを疑って
    // 本人がパスワードを変えても、攻撃者が持つ(または攻撃者が要求した)再設定リンクが生き残ると、
    // それでパスワードを上書きされてしまうため。
    await revokeAllPasswordResetTokensForUser(tx, { tenantId: input.tenantId, userId: input.userId, revokedAt: input.nowMinutes });

    await insertAuditLog(tx, {
      tenantId: input.tenantId,
      actorId: input.userId,
      action: "auth.password_change",
      targetType: "user",
      targetId: input.userId,
      detail: JSON.stringify({}),
      occurredAt: input.nowMinutes,
    });
    return true;
  });
}

// ---- 2. 「パスワードを忘れた」本人用の再設定 -----------------------------------

export interface SelfServiceResetTarget {
  tenantId: string;
  userId: string;
}

/**
 * メールアドレスに一致する、**有効(退職処理されていない)でパスワード資格情報を持つ**ユーザーを
 * 全テナントから探す。照合は users.email の完全一致 — POST /auth/login と同じ作法
 * (大文字小文字を区別する。メールの「入力どおり」を保存・照合する既存の方針に揃える)。
 * 並びは作成順(メールに載せるリンクの番号が安定する)。
 */
export async function findSelfServiceResetTargetsByEmail(db: Database, email: string): Promise<SelfServiceResetTarget[]> {
  return db
    .select({ tenantId: users.tenantId, userId: users.id })
    .from(users)
    .innerJoin(authCredentials, and(eq(authCredentials.userId, users.id), eq(authCredentials.tenantId, users.tenantId)))
    .where(and(eq(users.email, email), eq(users.isActive, true)))
    .orderBy(asc(users.createdAt), asc(users.id));
}

/**
 * メール単位の再送スロットル。`emailKey` に対する直近の送信から `throttleMinutes` 分以内なら
 * false(= 今回はメールを出さない)、そうでなければ時刻を記録して true を返す。
 *
 * 「SELECT して判定してから書く」ではなく **1本の `INSERT ... ON CONFLICT (email_key) DO UPDATE
 * ... WHERE requested_at <= 閾値 RETURNING`** にしてあるので、同時に N 本来ても true を得るのは
 * 1本だけ(競合した側は既存行の更新条件を最新の行に対して再評価され、0 行更新 = false になる)。
 * pending_signups の `upsertPendingSignupUnlessRecent` と同じ方式で、SQLite / PostgreSQL の
 * どちらでも成り立ち、トランザクションが要らない(D1 でも使える形)。
 *
 * 判断(token 表ではなく専用表にした理由): 「5分に1回」はメール単位(=複数テナントに跨る1通の
 * メール単位)の上限で、token 表はユーザー単位の行しか持てない。ユーザー単位で数えると、大文字小文字
 * だけ違う別ユーザーや複数テナントの組み合わせで上限をすり抜けられる。
 */
export async function acquirePasswordResetRequestSlot(
  db: Database | Transaction,
  params: { emailKey: string; nowMinutes: number; throttleMinutes: number },
): Promise<boolean> {
  const rows = await db
    .insert(passwordResetRequests)
    .values({ emailKey: params.emailKey, requestedAt: params.nowMinutes })
    .onConflictDoUpdate({
      target: passwordResetRequests.emailKey,
      set: { requestedAt: params.nowMinutes },
      setWhere: sql`${passwordResetRequests.requestedAt} <= ${params.nowMinutes - params.throttleMinutes}`,
    })
    .returning({ emailKey: passwordResetRequests.emailKey });
  return rows.length > 0;
}

export interface NewSelfServiceResetTokenInput {
  tenantId: string;
  userId: string;
  /** トークンの SHA-256(hex)。平文はここでは受け取らない */
  tokenHash: string;
  /** UTC エポック分 */
  expiresAt: number;
  createdAt: number;
}

/**
 * 本人発行(source = 'self')のリセットトークンを1本発行する(1トランザクション):
 * 同じユーザーの**本人発行で未使用・未失効**の古いトークンを失効させてから新規作成し、
 * 監査ログ `password_reset.self_request` を追記する。
 *
 * 管理者発行(source = 'admin')のトークンには触れない(本人が「忘れた」を押したことで、管理者が
 * 手渡したリンクが勝手に死ぬのを避ける)。逆に管理者の再発行(`createPasswordResetToken`)は
 * 従来どおり未決着の全トークン(本人発行を含む)を失効させる。
 * created_by は本人(user_id)。
 */
export async function issueSelfServicePasswordResetToken(
  db: Database,
  input: NewSelfServiceResetTokenInput,
): Promise<PasswordResetToken> {
  return db.transaction(async (tx) => {
    await tx
      .update(passwordResetTokens)
      .set({ revokedAt: input.createdAt })
      .where(
        and(
          eq(passwordResetTokens.tenantId, input.tenantId),
          eq(passwordResetTokens.userId, input.userId),
          eq(passwordResetTokens.source, "self"),
          isNull(passwordResetTokens.usedAt),
          isNull(passwordResetTokens.revokedAt),
        ),
      );

    const [row] = await tx
      .insert(passwordResetTokens)
      .values({
        id: uuidv7(),
        tenantId: input.tenantId,
        userId: input.userId,
        tokenHash: input.tokenHash,
        expiresAt: input.expiresAt,
        usedAt: null,
        revokedAt: null,
        createdBy: input.userId,
        source: "self",
        createdAt: input.createdAt,
      })
      .returning();
    if (!row) {
      throw new Error("issueSelfServicePasswordResetToken: insert returned no row");
    }

    await insertAuditLog(tx, {
      tenantId: input.tenantId,
      actorId: input.userId,
      action: "password_reset.self_request",
      targetType: "user",
      targetId: input.userId,
      detail: JSON.stringify({ expiresAt: input.expiresAt }),
      occurredAt: input.createdAt,
    });
    return row;
  });
}
