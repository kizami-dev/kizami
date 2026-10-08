/**
 * invitations に対するクエリ層(メンバー招待式登録、docs/requirements.md §認証)。
 *
 * - createInvitation: 発行。既存の「未決着」招待(未受諾・未失効。期限切れでも決着していなければ
 *   含む)を revoke してから新規作成する(1単位 — src/atomic.ts の atomic plan。D1 でも動く)。「有効(期限内)なものだけ」を
 *   都度計算するより「未決着は必ずテナント内ユーザーごとに高々1本」という不変条件のほうが
 *   単純で見通しがよいと判断した(schema/invitations.ts の部分UNIQUEを使わない判断点と対）
 * - findInvitationByTokenHash: 受諾用。行を返すだけで有効性(期限・失効・受諾済み)判定は
 *   呼び出し側(apps/api/src/routes/invitations.ts)の責務とする(404 と 410 を使い分けるため、
 *   ここで判定を握りつぶさない)
 * - getLatestInvitationForUser: あるユーザーの最新の招待(作成日時降順の先頭1件)
 * - listInvitationsForTenant: テナント全招待を作成日時降順で返す。呼び出し側
 *   (routes/members.ts)は listTenantMembershipsWithDepartment と同じ規約で、
 *   同一 userId が複数出現した場合は先頭(最新)のみを採用すること
 * - acceptInvitation: 受諾。accepted_at 設定 + auth_credentials 作成 + 監査ログを1単位で行う
 *   (src/atomic.ts の atomic plan。D1 でも動く)。UPDATE の WHERE 句に isNull(acceptedAt)/
 *   isNull(revokedAt) を含めることで、有効性の再検証と更新の間に別リクエストが割り込む TOCTOU を
 *   防ぐ(同時受諾は後勝ちが0件更新 → ガードで計画ごと失敗 → null。資格情報も監査ログも残らない)
 * - revokeInvitation: 取り消し。受諾済み・失効済みは対象外(0件更新でnull)
 * - userHasCredential / listTenantUserIdsWithCredentials: 「受諾済み(active)」の判定
 *   (auth_credentials の有無そのものが受諾済みの定義、docs/requirements.md §認証)
 */

import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { AtomicPlan, runAtomic, type AtomicExecutor } from "../atomic.js";
import type { Database, Transaction } from "../types.js";
import { authCredentials, invitations, memberships, userPolicyAssignments, users, workPolicies } from "../schema/index.js";
import { uuidv7 } from "../uuid.js";
import { auditLogInsertQuery } from "./audit.js";
import type { MemberUser } from "./members.js";
import { getTenantWorkPolicy } from "./work-policies.js";

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

/** 既存の未決着招待を revoke する update ビルダ(実行しない)。 */
function revokePendingInvitationsQuery(q: AtomicExecutor, input: NewInvitationInput) {
  return q
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
}

/** 新しい招待を1件作る insert ビルダ(実行しない)。 */
function insertInvitationQuery(q: AtomicExecutor, input: NewInvitationInput) {
  return q
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
}

/**
 * invitations へ1件発行する(既存の未決着招待を revoke してから作成、1単位)。
 * 単独呼び出し用。メンバー作成と同じ単位で発行したい場合(apps/api/src/routes/members.ts の POST /)は
 * `createInvitedMember` を使うこと。
 *
 * 判断点(2026-10-07、D1 対応): revoke と insert はどちらも無条件の書き込みで、途中の結果で
 * 分岐しない。そのため atomic plan(src/atomic.ts)へそのまま積める(ガード不要)。
 */
export async function createInvitation(db: Database, input: NewInvitationInput): Promise<Invitation> {
  const plan = new AtomicPlan();
  plan.add((q) => revokePendingInvitationsQuery(q, input));
  const inserted = plan.add((q) => insertInvitationQuery(q, input));
  const result = await runAtomic(db, plan);
  // ガードを積んでいないので ok: false にはならない
  const row = result.ok ? result.get(inserted)[0] : undefined;
  if (!row) {
    throw new Error("createInvitation: insert returned no row");
  }
  return row;
}

/**
 * createInvitation と同じ処理を、呼び出し側が既に開始した外側のトランザクション `tx` の中で
 * 行う(自分では db.transaction() を呼ばない)。D1 では外側のトランザクションを張れないので、
 * API(members.ts の POST /)は 2026-10-08 から atomic plan 版の `createInvitedMember` を使う。
 * これは外側のトランザクションに乗せたい Node 専用の呼び出し(テスト・運用ツール)のために残す。
 */
export async function createInvitationInTx(tx: Transaction, input: NewInvitationInput): Promise<Invitation> {
  await revokePendingInvitationsQuery(tx, input);
  const [row] = await insertInvitationQuery(tx, input);
  if (!row) {
    throw new Error("createInvitation: insert returned no row");
  }
  return row;
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
 * 招待を受諾する: 有効性の再検証・accepted_at 設定・auth_credentials 作成・監査ログ追記を
 * 1単位で行う(監査ログの同居は2026-08-23 追加 — 以前は呼び出し側が受諾成功の
 * 判定後に別トランザクションで書いており、auth_credentials は作られたのに監査ログだけ
 * 書き漏れる余地があった)。失敗(存在しない・失効済み・受諾済み・期限切れ)は null を返す —
 * 理由の切り分け(404 vs 410)は呼び出し側(apps/api/src/routes/invitations.ts)が
 * トークン探索時に別途行う。
 *
 * 判断点(2026-10-07、D1 対応。docs/design/d1-atomic-writes.md): 書き込みは atomic plan
 * (src/atomic.ts)で「claim(条件付き UPDATE)→ ガード → 資格情報 → 監査ログ」の順に積む。
 * claim が 0 行(先に別リクエストが受諾・失効させた TOCTOU)ならガードが計画ごと失敗させ、
 * 資格情報も監査ログも書かれない。読み取り(トークン探索と有効性の事前判定)は計画の外。
 *
 * セッション発行(createSession)はこの関数の外側・別トランザクションのまま(呼び出し側の
 * apps/api/src/routes/invitations.ts が行う)。アカウントの有効化(この計画)と
 * ログイン状態にすることは別の関心事であり、後者が失敗してもアカウント自体は有効化済みで
 * あるべきなので、あえて分離を保っている。
 */
export async function acceptInvitation(db: Database, input: AcceptInvitationInput): Promise<AcceptedInvitation | null> {
  const rows = await db.select().from(invitations).where(eq(invitations.tokenHash, input.tokenHash)).limit(1);
  const invitation = rows[0];
  if (!invitation) return null;
  if (invitation.revokedAt !== null || invitation.acceptedAt !== null || invitation.expiresAt <= input.nowMinutes) {
    return null;
  }

  const plan = new AtomicPlan();
  // WHERE に isNull(acceptedAt)/isNull(revokedAt)/期限を再度含めることで、直前の SELECT から
  // ここまでの間に別リクエストが先に受諾・失効させていた場合(TOCTOU)を検出する。
  const claim = plan.add((q) =>
    q
      .update(invitations)
      .set({ acceptedAt: input.nowMinutes })
      .where(
        and(
          eq(invitations.id, invitation.id),
          isNull(invitations.acceptedAt),
          isNull(invitations.revokedAt),
          gt(invitations.expiresAt, input.nowMinutes),
        ),
      )
      .returning(),
  );
  plan.guard("invitation.claim");
  plan.add((q) =>
    q.insert(authCredentials).values({
      id: uuidv7(),
      tenantId: invitation.tenantId,
      userId: invitation.userId,
      passwordHash: input.passwordHash,
      createdAt: input.nowMinutes,
      updatedAt: input.nowMinutes,
    }),
  );
  plan.add((q) =>
    auditLogInsertQuery(q, {
      tenantId: invitation.tenantId,
      actorId: invitation.userId,
      action: "invitation.accept",
      targetType: "user",
      targetId: invitation.userId,
      detail: JSON.stringify({}),
      occurredAt: input.nowMinutes,
    }),
  );

  const result = await runAtomic(db, plan);
  if (!result.ok) return null;
  const [updated] = result.get(claim);
  if (!updated) {
    // ガードを通った以上 claim は1行返している(ここに来たら atomic plan の不具合)
    throw new Error("acceptInvitation: claim returned no row after the guard passed");
  }
  return { invitation: updated, tenantId: invitation.tenantId, userId: invitation.userId };
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

export interface CreateInvitedMemberInput {
  tenantId: string;
  email: string;
  name: string;
  hireDate: string | null;
  /** 所属部署(省略 = 部署未設定) */
  departmentId?: string;
  /**
   * 割り当てる制度。省略時はテナント既定の制度(`getTenantWorkPolicy`。無ければ
   * `defaultWorkPolicyName` で作る)。指定時の妥当性(同テナント・未アーカイブ)の検証は呼び出し側の責務
   */
  workPolicyId?: string;
  /** 既定の制度が1つも無いときに作る制度の名前(通常運用では seed 済みで使われない) */
  defaultWorkPolicyName: string;
  /** 制度の割当の適用開始日(ローカル日付 "YYYY-MM-DD") */
  effectiveFrom: string;
  /** 招待トークンの SHA-256(hex) */
  tokenHash: string;
  /** UTC エポック分 */
  expiresAt: number;
  /** 招待した管理者(招待の created_by・監査ログの actor) */
  actorId: string;
  /** UTC エポック分 */
  createdAt: number;
}

export interface CreatedInvitedMember {
  user: MemberUser;
  invitation: Invitation;
}

/**
 * メンバーの作成と招待(POST /members)の書き込み一式を1単位で行う: users → 所属 →(既定の制度が
 * 無ければ作成)→ 制度の割当 → 招待 → 監査ログ `member.invite`。
 *
 * 判断点(2026-10-08、D1 対応。docs/design/d1-atomic-writes.md #23): db.transaction() + `*InTx` から
 * atomic plan(src/atomic.ts)へ移した。どれも途中の結果で分岐しない書き込みなので、ガードは無い:
 *
 * - **ID はすべて計画の前に決める**(users・制度)。後続の文(所属・割当・招待)の外部キーに使う
 * - 既定の制度の get-or-create は、get を計画の前に済ませ、無いときだけ insert を計画に積む。
 *   既定の制度は seed / テナント作成で必ず作られるので、ここで作るのは移行前のデータだけ
 *   (同時に2本作られうるのは従来の db.transaction() 版と同じ。READ COMMITTED では従来も防げていない)
 * - 新規ユーザーなので未決着の招待は無い。createInvitation の「revoke → 発行」の revoke は省く
 * - メールの重複は UNIQUE(tenant_id, email) 違反として**そのまま投げる**(計画ごと巻き戻る)。
 *   呼び出し側は従来どおり `isUniqueConstraintError` で 409 にする
 */
export async function createInvitedMember(db: Database, input: CreateInvitedMemberInput): Promise<CreatedInvitedMember> {
  const userId = uuidv7();
  const plan = new AtomicPlan();

  const createdUser = plan.add((q) =>
    q
      .insert(users)
      .values({
        id: userId,
        tenantId: input.tenantId,
        email: input.email,
        name: input.name,
        isActive: true,
        hireDate: input.hireDate,
        createdAt: input.createdAt,
      })
      .returning(),
  );

  const departmentId = input.departmentId;
  if (departmentId !== undefined) {
    plan.add((q) =>
      q.insert(memberships).values({ id: uuidv7(), tenantId: input.tenantId, userId, departmentId, createdAt: input.createdAt }),
    );
  }

  let workPolicyId = input.workPolicyId;
  if (workPolicyId === undefined) {
    const existing = await getTenantWorkPolicy(db, input.tenantId);
    if (existing) {
      workPolicyId = existing.id;
    } else {
      const newPolicyId = uuidv7();
      workPolicyId = newPolicyId;
      plan.add((q) =>
        q.insert(workPolicies).values({ id: newPolicyId, tenantId: input.tenantId, name: input.defaultWorkPolicyName, createdAt: input.createdAt }),
      );
    }
  }
  const assignedPolicyId = workPolicyId;
  plan.add((q) =>
    q.insert(userPolicyAssignments).values({
      id: uuidv7(),
      tenantId: input.tenantId,
      userId,
      workPolicyId: assignedPolicyId,
      effectiveFrom: input.effectiveFrom,
      createdAt: input.createdAt,
    }),
  );

  const invitation = plan.add((q) =>
    insertInvitationQuery(q, {
      tenantId: input.tenantId,
      userId,
      tokenHash: input.tokenHash,
      expiresAt: input.expiresAt,
      createdBy: input.actorId,
      createdAt: input.createdAt,
    }),
  );

  plan.add((q) =>
    auditLogInsertQuery(q, {
      tenantId: input.tenantId,
      actorId: input.actorId,
      action: "member.invite",
      targetType: "user",
      targetId: userId,
      detail: JSON.stringify({
        email: input.email,
        departmentId: input.departmentId ?? null,
        // 招待で制度を選んだときだけ残す(既定の制度の自動割当は従来どおり記録しない)。
        ...(input.workPolicyId !== undefined ? { workPolicyId: input.workPolicyId } : {}),
      }),
      occurredAt: input.createdAt,
    }),
  );

  const result = await runAtomic(db, plan);
  // ガードを積んでいないので ok: false にはならない
  const user = result.ok ? result.get(createdUser)[0] : undefined;
  const createdInvitation = result.ok ? result.get(invitation)[0] : undefined;
  if (!user || !createdInvitation) {
    throw new Error("createInvitedMember: insert returned no row");
  }
  return { user, invitation: createdInvitation };
}
