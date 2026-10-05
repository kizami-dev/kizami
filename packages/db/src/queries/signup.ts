/**
 * セルフサインアップ(signup_invite_codes / pending_signups、schema/signup.ts)のクエリ層。
 *
 * どちらの表も tenant_id を持たない**システム表**(docs/design/multi-tenancy.md「システム表の例外」)。
 * このファイルの関数は routes/signup.ts・運用者 CLI(operator.ts)・掃除ジョブ(signup-cleanup.ts)
 * だけが使う。テナント向けのクエリから呼ばないこと。
 *
 * - 招待コード: create / list / revoke / ハッシュ検索 / 有効性判定(消費はしない)/
 *   `consumeSignupInviteCode`(条件付き UPDATE で +1。同時確認でも max_uses を超えない)
 * - pending_signups: `upsertPendingSignupUnlessRecent`(同一メールの未消費行を原子的に置き換え、直近なら抑止)/
 *   ハッシュ検索 / `consumePendingSignup`(未消費・未期限を条件にした UPDATE。二重確認の排他)/
 *   `deleteStalePendingSignups`(掃除)
 * - `listTenantsWithActiveUserCount`: 運用者 CLI の `tenant list` 用の唯一のテナント横断読み取り
 */

import { and, asc, desc, eq, gt, isNull, lt, or, sql } from "drizzle-orm";
import type { Database, Transaction } from "../types.js";
import { pendingSignups, signupInviteCodes, tenants, users } from "../schema/index.js";
import { uuidv7 } from "../uuid.js";

export type SignupInviteCode = typeof signupInviteCodes.$inferSelect;
export type PendingSignup = typeof pendingSignups.$inferSelect;

// ---- 招待コード ------------------------------------------------------------

export interface NewSignupInviteCodeInput {
  /** コードの SHA-256(hex)。平文はここでは受け取らない */
  codeHash: string;
  note: string | null;
  maxUses: number;
  /** UTC エポック分。null = 無期限 */
  expiresAt: number | null;
  createdAt: number;
}

export async function createSignupInviteCode(db: Database | Transaction, input: NewSignupInviteCodeInput): Promise<SignupInviteCode> {
  const [row] = await db
    .insert(signupInviteCodes)
    .values({
      id: uuidv7(),
      codeHash: input.codeHash,
      note: input.note,
      maxUses: input.maxUses,
      usedCount: 0,
      expiresAt: input.expiresAt,
      revokedAt: null,
      createdAt: input.createdAt,
    })
    .returning();
  if (!row) {
    throw new Error("createSignupInviteCode: insert returned no row");
  }
  return row;
}

/** 作成の新しい順(id は uuidv7 でタイブレークも時系列)。 */
export async function listSignupInviteCodes(db: Database): Promise<SignupInviteCode[]> {
  return db.select().from(signupInviteCodes).orderBy(desc(signupInviteCodes.createdAt), desc(signupInviteCodes.id));
}

export async function findSignupInviteCodeByHash(db: Database | Transaction, codeHash: string): Promise<SignupInviteCode | null> {
  const rows = await db.select().from(signupInviteCodes).where(eq(signupInviteCodes.codeHash, codeHash)).limit(1);
  return rows[0] ?? null;
}

/** 失効する(行は消さない)。既に失効済み・存在しない場合は null。 */
export async function revokeSignupInviteCode(
  db: Database | Transaction,
  params: { id: string; revokedAt: number },
): Promise<SignupInviteCode | null> {
  const [row] = await db
    .update(signupInviteCodes)
    .set({ revokedAt: params.revokedAt })
    .where(and(eq(signupInviteCodes.id, params.id), isNull(signupInviteCodes.revokedAt)))
    .returning();
  return row ?? null;
}

/**
 * コードが今この瞬間使えるか(失効・期限・使用回数)。**消費はしない**
 * (POST /signup の入口チェック用。消費は確認完了のトランザクション内の consumeSignupInviteCode)。
 */
export function isSignupInviteCodeUsable(code: SignupInviteCode, nowMinutes: number): boolean {
  if (code.revokedAt !== null) return false;
  if (code.expiresAt !== null && code.expiresAt <= nowMinutes) return false;
  return code.usedCount < code.maxUses;
}

/**
 * コードを1回消費する(used_count + 1)。有効性の条件を UPDATE の WHERE に含めた
 * **条件付き UPDATE** にしてあるので、SELECT して判定してから書く TOCTOU が無く、
 * 同時に確認が走っても max_uses を超えて消費できない(超過した側は 0 件更新で false)。
 */
export async function consumeSignupInviteCode(
  db: Database | Transaction,
  params: { id: string; nowMinutes: number },
): Promise<boolean> {
  const rows = await db
    .update(signupInviteCodes)
    .set({ usedCount: sql`${signupInviteCodes.usedCount} + 1` })
    .where(
      and(
        eq(signupInviteCodes.id, params.id),
        isNull(signupInviteCodes.revokedAt),
        or(isNull(signupInviteCodes.expiresAt), gt(signupInviteCodes.expiresAt, params.nowMinutes)),
        lt(signupInviteCodes.usedCount, signupInviteCodes.maxUses),
      ),
    )
    .returning({ id: signupInviteCodes.id });
  return rows.length > 0;
}

// ---- pending_signups -------------------------------------------------------

export interface NewPendingSignupInput {
  /** 申請者が入力したメール(trim 済み)。管理者ユーザーの作成にそのまま使う */
  email: string;
  /** 照合キー(trim + 小文字化)。再送スロットル・置き換えの単位 */
  emailKey: string;
  organizationName: string;
  adminName: string;
  /** 確認トークンの SHA-256(hex) */
  tokenHash: string;
  inviteCodeId: string | null;
  /** UTC エポック分 */
  expiresAt: number;
  createdAt: number;
}

/**
 * pending を作る。ただし**同じメール(emailKey)の未消費 pending が `throttleMinutes` 分以内に
 * 作られていれば何もしない**(null を返す。呼び出し側はメールを送らない)。それより古い
 * (期限切れを含む)未消費行があれば、その行を新しい内容に置き換える(古いリンクは無効になる)。
 *
 * 「判定してから書く」を **1本の `INSERT ... ON CONFLICT (email_key) WHERE consumed_at IS NULL
 * DO UPDATE ... WHERE created_at <= 閾値 RETURNING`** で行う。部分 UNIQUE(schema/signup.ts)が
 * 競合を検出し、更新条件(閾値)は競合時に最新の行に対して評価されるので、同時に N 本来ても
 * 行を得る(= メールを送る)のは1本だけで、残りは null になる。SQLite でも PostgreSQL
 * (READ COMMITTED でも、ON CONFLICT DO UPDATE は競合行をロックして再評価する)でも成り立つ。
 * トランザクションは要らない(1文で原子的)。
 */
export async function upsertPendingSignupUnlessRecent(
  db: Database | Transaction,
  input: NewPendingSignupInput,
  options: { throttleMinutes: number },
): Promise<PendingSignup | null> {
  const values = {
    id: uuidv7(),
    email: input.email,
    emailKey: input.emailKey,
    organizationName: input.organizationName,
    adminName: input.adminName,
    tokenHash: input.tokenHash,
    inviteCodeId: input.inviteCodeId,
    expiresAt: input.expiresAt,
    consumedAt: null,
    tenantId: null,
    createdAt: input.createdAt,
  };
  const [row] = await db
    .insert(pendingSignups)
    .values(values)
    .onConflictDoUpdate({
      // 部分 UNIQUE の述語は非修飾の列名で書く(PostgreSQL は推論述語での修飾付き参照を拒否する)
      target: pendingSignups.emailKey,
      targetWhere: sql`consumed_at is null`,
      set: values,
      setWhere: sql`${pendingSignups.createdAt} <= ${input.createdAt - options.throttleMinutes}`,
    })
    .returning();
  return row ?? null;
}

/** トークンのハッシュから1件探す。有効性(期限・消費済み)の判定は呼び出し側。 */
export async function findPendingSignupByTokenHash(db: Database | Transaction, tokenHash: string): Promise<PendingSignup | null> {
  const rows = await db.select().from(pendingSignups).where(eq(pendingSignups.tokenHash, tokenHash)).limit(1);
  return rows[0] ?? null;
}

/**
 * pending を消費済みにする(consumed_at を立てる)。未消費かつ未期限を WHERE に含めた条件付き
 * UPDATE なので、同じトークンの二重確認は片方だけが行を得る(もう一方は null)。
 * テナント ID は作成後に `setPendingSignupTenant` で記録する(テナント作成の前に排他を取るため)。
 */
export async function consumePendingSignup(
  db: Database | Transaction,
  params: { id: string; nowMinutes: number },
): Promise<PendingSignup | null> {
  const [row] = await db
    .update(pendingSignups)
    .set({ consumedAt: params.nowMinutes })
    .where(and(eq(pendingSignups.id, params.id), isNull(pendingSignups.consumedAt), gt(pendingSignups.expiresAt, params.nowMinutes)))
    .returning();
  return row ?? null;
}

/** 確認完了で作られたテナントを記録する。 */
export async function setPendingSignupTenant(db: Database | Transaction, params: { id: string; tenantId: string }): Promise<void> {
  await db.update(pendingSignups).set({ tenantId: params.tenantId }).where(eq(pendingSignups.id, params.id));
}

/**
 * 掃除: 期限(expires_at)が `expiredBefore` より前で未消費の行を消す。消した件数を返す。
 * 消費済みの行(テナント作成の記録)は消さない。
 */
export async function deleteStalePendingSignups(db: Database, params: { expiredBefore: number }): Promise<number> {
  const rows = await db
    .delete(pendingSignups)
    .where(and(isNull(pendingSignups.consumedAt), lt(pendingSignups.expiresAt, params.expiredBefore)))
    .returning({ id: pendingSignups.id });
  return rows.length;
}

// ---- 運用者向け ------------------------------------------------------------

export interface TenantOverviewRow {
  id: string;
  name: string;
  createdAt: number;
  activeUserCount: number;
  /** 退会手続き中なら削除予定の時刻(UTC エポック分)、通常の状態なら null(docs/design/tenant-withdrawal.md) */
  withdrawalScheduledPurgeAt: number | null;
}

/** 運用者 CLI(`tenant list`)用。全テナントを作成順に、有効ユーザー数付きで返す。 */
export async function listTenantsWithActiveUserCount(db: Database): Promise<TenantOverviewRow[]> {
  const tenantRows = await db.select().from(tenants).orderBy(asc(tenants.createdAt), asc(tenants.id));
  const counts = await db
    .select({ tenantId: users.tenantId, count: sql<number>`count(*)` })
    .from(users)
    .where(eq(users.isActive, true))
    .groupBy(users.tenantId);
  const countByTenant = new Map(counts.map((r) => [r.tenantId, Number(r.count)]));
  return tenantRows.map((t) => ({
    id: t.id,
    name: t.name,
    createdAt: t.createdAt,
    activeUserCount: countByTenant.get(t.id) ?? 0,
    withdrawalScheduledPurgeAt: t.withdrawalRequestedAt === null ? null : t.withdrawalScheduledPurgeAt,
  }));
}
