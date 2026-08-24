/**
 * 有給休暇管理(§5)のクエリ層。tenant_leave_settings / leave_grants / leave_requests /
 * leave_grant_proposals(付与予告、v0.7)。
 */

import { and, asc, desc, eq, gte, inArray, lte, ne } from "drizzle-orm";
import type { Database, Transaction } from "../migrate.js";
import { leaveGrantProposals, leaveGrants, leaveRequests, tenantLeaveSettings } from "../schema/index.js";
import { uuidv7 } from "../uuid.js";

// ---- tenant_leave_settings ----

export type TenantLeaveSettings = typeof tenantLeaveSettings.$inferSelect;

export async function getTenantLeaveSettings(db: Database, tenantId: string): Promise<TenantLeaveSettings | null> {
  const rows = await db.select().from(tenantLeaveSettings).where(eq(tenantLeaveSettings.tenantId, tenantId)).limit(1);
  return rows[0] ?? null;
}

export interface UpsertTenantLeaveSettingsInput {
  tenantId: string;
  grantMethod: string;
  fixedDateMmDd: string | null;
  hourlyLeaveEnabled: boolean;
  hourlyLeaveMaxDays: number;
  halfDayLeaveEnabled: boolean;
  stockConversionEnabled: boolean;
  stockMaxDays: number;
  stockExpiresMonths: number | null;
  updatedAt: number;
  updatedBy: string;
}

export async function upsertTenantLeaveSettings(db: Database, input: UpsertTenantLeaveSettingsInput): Promise<TenantLeaveSettings> {
  const [row] = await db
    .insert(tenantLeaveSettings)
    .values(input)
    .onConflictDoUpdate({
      target: tenantLeaveSettings.tenantId,
      set: {
        grantMethod: input.grantMethod,
        fixedDateMmDd: input.fixedDateMmDd,
        hourlyLeaveEnabled: input.hourlyLeaveEnabled,
        hourlyLeaveMaxDays: input.hourlyLeaveMaxDays,
        halfDayLeaveEnabled: input.halfDayLeaveEnabled,
        stockConversionEnabled: input.stockConversionEnabled,
        stockMaxDays: input.stockMaxDays,
        stockExpiresMonths: input.stockExpiresMonths,
        updatedAt: input.updatedAt,
        updatedBy: input.updatedBy,
      },
    })
    .returning();
  if (!row) {
    throw new Error("upsertTenantLeaveSettings: insert/update returned no row");
  }
  return row;
}

// ---- leave_grants ----

export type LeaveGrant = typeof leaveGrants.$inferSelect;

export interface NewLeaveGrantInput {
  tenantId: string;
  userId: string;
  leaveType: string;
  grantedOn: string;
  days: number;
  expiresOn: string;
  source: string;
  convertedFromGrantId?: string | null;
  note?: string | null;
  createdAt: number;
}

export async function insertLeaveGrant(db: Database | Transaction, input: NewLeaveGrantInput): Promise<LeaveGrant> {
  const [row] = await db
    .insert(leaveGrants)
    .values({
      id: uuidv7(),
      tenantId: input.tenantId,
      userId: input.userId,
      leaveType: input.leaveType,
      grantedOn: input.grantedOn,
      days: input.days,
      expiresOn: input.expiresOn,
      source: input.source,
      convertedFromGrantId: input.convertedFromGrantId ?? null,
      note: input.note ?? null,
      createdAt: input.createdAt,
    })
    .returning();
  if (!row) {
    throw new Error("insertLeaveGrant: insert returned no row");
  }
  return row;
}

export async function listLeaveGrants(db: Database, params: { tenantId: string; userId: string }): Promise<LeaveGrant[]> {
  return db
    .select()
    .from(leaveGrants)
    .where(and(eq(leaveGrants.tenantId, params.tenantId), eq(leaveGrants.userId, params.userId)))
    .orderBy(asc(leaveGrants.grantedOn));
}

/** 法定自動付与(POST /leave/grants/auto)の冪等性チェックに使う: 既存の granted_on の集合。 */
export async function listGrantedOnDates(db: Database, params: { tenantId: string; userId: string }): Promise<Set<string>> {
  const rows = await db
    .select({ grantedOn: leaveGrants.grantedOn })
    .from(leaveGrants)
    .where(and(eq(leaveGrants.tenantId, params.tenantId), eq(leaveGrants.userId, params.userId)));
  return new Set(rows.map((r) => r.grantedOn));
}

/** 積立振替(POST /leave/grants/convert-expired)の二重振替防止に使う: 既に振替済みの元付与IDの集合。 */
export async function listConvertedFromGrantIds(db: Database, params: { tenantId: string; userId: string }): Promise<Set<string>> {
  const rows = await db
    .select({ convertedFromGrantId: leaveGrants.convertedFromGrantId })
    .from(leaveGrants)
    .where(and(eq(leaveGrants.tenantId, params.tenantId), eq(leaveGrants.userId, params.userId)));
  return new Set(rows.map((r) => r.convertedFromGrantId).filter((id): id is string => id !== null));
}

// ---- leave_requests ----

export type LeaveRequest = typeof leaveRequests.$inferSelect;
export type LeaveRequestStatus = "pending" | "approved_step1" | "approved" | "rejected" | "withdrawn";

export interface NewLeaveRequestInput {
  tenantId: string;
  userId: string;
  requestedBy: string;
  leaveDate: string;
  unit: string;
  minutes?: number | null;
  leaveType: string;
  reason: string;
  /**
   * 承認に必要な段数(1 = 単段 / 2 = 二段)。省略時は 1。作成時点のテナント設定を
   * 凍結して保存する(グランドファザリング。schema/corrections.ts のコメント参照)。
   */
  requiredSteps?: number;
  createdAt: number;
}

export async function createLeaveRequest(db: Database, input: NewLeaveRequestInput): Promise<LeaveRequest> {
  const [row] = await db
    .insert(leaveRequests)
    .values({
      id: uuidv7(),
      tenantId: input.tenantId,
      userId: input.userId,
      requestedBy: input.requestedBy,
      status: "pending",
      requiredSteps: input.requiredSteps ?? 1,
      leaveDate: input.leaveDate,
      unit: input.unit,
      minutes: input.minutes ?? null,
      leaveType: input.leaveType,
      reason: input.reason,
      createdAt: input.createdAt,
    })
    .returning();
  if (!row) {
    throw new Error("createLeaveRequest: insert returned no row");
  }
  return row;
}

export interface ListLeaveRequestsParams {
  tenantId: string;
  userId?: string;
  status?: LeaveRequestStatus;
}

export async function listLeaveRequests(db: Database, params: ListLeaveRequestsParams): Promise<LeaveRequest[]> {
  const conditions = [eq(leaveRequests.tenantId, params.tenantId)];
  if (params.userId !== undefined) conditions.push(eq(leaveRequests.userId, params.userId));
  if (params.status !== undefined) conditions.push(eq(leaveRequests.status, params.status));

  return db
    .select()
    .from(leaveRequests)
    .where(and(...conditions))
    .orderBy(desc(leaveRequests.createdAt), desc(leaveRequests.id));
}

export async function getLeaveRequest(db: Database, id: string): Promise<LeaveRequest | null> {
  const rows = await db.select().from(leaveRequests).where(eq(leaveRequests.id, id)).limit(1);
  return rows[0] ?? null;
}

/**
 * GET /attendance/monthly の paidLeave 組み立て、および残高・年5日計算の入力に使う。
 *
 * `Database | Transaction` を受け取る(apps/api/src/lib/closing-amend.ts が締め後修正の
 * 反映と同一トランザクションで月次を再計算するために必要)。
 */
export async function listApprovedLeaveRequestsInRange(
  db: Database | Transaction,
  params: { tenantId: string; userId: string; fromDate: string; toDate: string },
): Promise<LeaveRequest[]> {
  return db
    .select()
    .from(leaveRequests)
    .where(
      and(
        eq(leaveRequests.tenantId, params.tenantId),
        eq(leaveRequests.userId, params.userId),
        eq(leaveRequests.status, "approved"),
        gte(leaveRequests.leaveDate, params.fromDate),
        lte(leaveRequests.leaveDate, params.toDate),
      ),
    )
    .orderBy(asc(leaveRequests.leaveDate));
}

/** 残高・年5日追跡は全期間の承認済み申請が必要(FIFO・時効判定のため範囲を絞れない)。 */
export async function listAllApprovedLeaveRequests(db: Database, params: { tenantId: string; userId: string }): Promise<LeaveRequest[]> {
  return db
    .select()
    .from(leaveRequests)
    .where(and(eq(leaveRequests.tenantId, params.tenantId), eq(leaveRequests.userId, params.userId), eq(leaveRequests.status, "approved")))
    .orderBy(asc(leaveRequests.leaveDate));
}

/**
 * 同日の重複申請チェック(pending / approved_step1 / approved)に使う。unit ごとの衝突判定は
 * 呼び出し側(routes/leave.ts)で行う。
 *
 * approved_step1(二段承認の一次承認済み・二次承認待ち)も「生きている申請」として数える —
 * まだ反映されていないだけで、これから承認されうるため、同じ日に重ねて申請できてしまうと
 * 二重取得になる(docs/design/approval-flows.md「中間状態の扱い」)。
 */
export async function listActiveLeaveRequestsForDate(
  db: Database,
  params: { tenantId: string; userId: string; leaveDate: string },
): Promise<LeaveRequest[]> {
  const rows = await db
    .select()
    .from(leaveRequests)
    .where(and(eq(leaveRequests.tenantId, params.tenantId), eq(leaveRequests.userId, params.userId), eq(leaveRequests.leaveDate, params.leaveDate)));
  return rows.filter((r) => r.status === "pending" || r.status === "approved_step1" || r.status === "approved");
}

export interface UpdateLeaveRequestStatusParams {
  id: string;
  tenantId: string;
  fromStatus?: LeaveRequestStatus;
  status: LeaveRequestStatus;
  decidedBy?: string | null;
  decidedAt?: number | null;
  decisionNote?: string | null;
  /**
   * 二段承認の一次承認者・一次承認時刻。**渡したときだけ書き込む**(省略時は既存値を保つ)。
   * 二次承認・却下では省略することで、一次承認者の記録が消えないようにしている。
   */
  step1DecidedBy?: string;
  /** UTC エポック分 */
  step1DecidedAt?: number;
}

/** status を更新する。fromStatus を渡すと条件付き UPDATE になり、0件更新なら null を返す(楽観ロック)。 */
export async function updateLeaveRequestStatus(
  db: Database | Transaction,
  params: UpdateLeaveRequestStatusParams,
): Promise<LeaveRequest | null> {
  const conditions = [eq(leaveRequests.id, params.id), eq(leaveRequests.tenantId, params.tenantId)];
  if (params.fromStatus !== undefined) {
    conditions.push(eq(leaveRequests.status, params.fromStatus));
  }

  const [row] = await db
    .update(leaveRequests)
    .set({
      status: params.status,
      decidedBy: params.decidedBy ?? null,
      decidedAt: params.decidedAt ?? null,
      ...(params.step1DecidedBy !== undefined ? { step1DecidedBy: params.step1DecidedBy } : {}),
      ...(params.step1DecidedAt !== undefined ? { step1DecidedAt: params.step1DecidedAt } : {}),
      decisionNote: params.decisionNote ?? null,
    })
    .where(and(...conditions))
    .returning();
  return row ?? null;
}

// ---- leave_grant_proposals(有給付与の予告、v0.7) ----

export type LeaveGrantProposal = typeof leaveGrantProposals.$inferSelect;

/** 予告の状態。superseded は「予告を経由せず POST /leave/grants/auto で同じ付与が作られた」場合。 */
export type LeaveGrantProposalStatus = "proposed" | "approved" | "rejected" | "superseded";

export interface NewLeaveGrantProposalInput {
  tenantId: string;
  userId: string;
  leaveType: string;
  grantedOn: string;
  days: number;
  expiresOn: string;
  /** packages/leave の AttendanceRateReference を JSON.stringify した文字列 */
  attendanceRate: string;
  /** UTC エポック分 */
  proposedAt: number;
}

/**
 * 予告を1件追記する。呼び出し側は必ず先に `findActiveLeaveGrantProposal` で重複が無いことを
 * 確認すること(一意性はクエリ層で担保する — schema/leave.ts の判断点コメント参照)。
 */
export async function insertLeaveGrantProposal(
  db: Database | Transaction,
  input: NewLeaveGrantProposalInput,
): Promise<LeaveGrantProposal> {
  const [row] = await db
    .insert(leaveGrantProposals)
    .values({
      id: uuidv7(),
      tenantId: input.tenantId,
      userId: input.userId,
      leaveType: input.leaveType,
      grantedOn: input.grantedOn,
      days: input.days,
      expiresOn: input.expiresOn,
      attendanceRate: input.attendanceRate,
      status: "proposed",
      proposedAt: input.proposedAt,
      decidedBy: null,
      decidedAt: null,
      decisionNote: null,
      grantId: null,
      createdAt: input.proposedAt,
    })
    .returning();
  if (!row) {
    throw new Error("insertLeaveGrantProposal: insert returned no row");
  }
  return row;
}

/**
 * (tenant, user, leaveType, grantedOn) について superseded 以外の予告があれば返す
 * (= 「もう予告済み(あるいは決裁済み)なので作り直さない」の判定に使う)。
 *
 * 判断点: `rejected` も「作り直さない」側に数える。却下は「この基準日については付与しない」と
 * いう管理者の意思決定であり、翌日のワーカー実行で同じ予告が復活すると却下の意味が無くなる
 * (依頼「reject blocks re-proposal」)。却下後にやはり付与したくなった場合は手動の
 * POST /leave/grants/auto(あるいは POST /leave/grants)を使う。
 */
export async function findActiveLeaveGrantProposal(
  db: Database | Transaction,
  params: { tenantId: string; userId: string; leaveType: string; grantedOn: string },
): Promise<LeaveGrantProposal | null> {
  const rows = await db
    .select()
    .from(leaveGrantProposals)
    .where(
      and(
        eq(leaveGrantProposals.tenantId, params.tenantId),
        eq(leaveGrantProposals.userId, params.userId),
        eq(leaveGrantProposals.leaveType, params.leaveType),
        eq(leaveGrantProposals.grantedOn, params.grantedOn),
        ne(leaveGrantProposals.status, "superseded"),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export interface ListLeaveGrantProposalsParams {
  tenantId: string;
  /** 省略時は全状態 */
  statuses?: LeaveGrantProposalStatus[];
  /** 省略時はテナント全体(呼び出し側でスコープ内ユーザーに絞る) */
  userIds?: string[];
}

/** 予告一覧(基準日昇順→同日は作成順)。 */
export async function listLeaveGrantProposals(
  db: Database | Transaction,
  params: ListLeaveGrantProposalsParams,
): Promise<LeaveGrantProposal[]> {
  const conditions = [eq(leaveGrantProposals.tenantId, params.tenantId)];
  if (params.statuses !== undefined) {
    if (params.statuses.length === 0) return [];
    conditions.push(inArray(leaveGrantProposals.status, params.statuses));
  }
  if (params.userIds !== undefined) {
    if (params.userIds.length === 0) return [];
    conditions.push(inArray(leaveGrantProposals.userId, params.userIds));
  }
  return db
    .select()
    .from(leaveGrantProposals)
    .where(and(...conditions))
    .orderBy(asc(leaveGrantProposals.grantedOn), asc(leaveGrantProposals.createdAt));
}

export async function getLeaveGrantProposal(
  db: Database | Transaction,
  params: { tenantId: string; id: string },
): Promise<LeaveGrantProposal | null> {
  const rows = await db
    .select()
    .from(leaveGrantProposals)
    .where(and(eq(leaveGrantProposals.tenantId, params.tenantId), eq(leaveGrantProposals.id, params.id)))
    .limit(1);
  return rows[0] ?? null;
}

export interface UpdateLeaveGrantProposalStatusParams {
  tenantId: string;
  id: string;
  /** 渡すと条件付き UPDATE になり、0件更新なら null(楽観ロック。updateLeaveRequestStatus と同じ形) */
  fromStatus?: LeaveGrantProposalStatus;
  status: LeaveGrantProposalStatus;
  decidedBy?: string | null;
  decidedAt?: number | null;
  decisionNote?: string | null;
  grantId?: string | null;
}

export async function updateLeaveGrantProposalStatus(
  db: Database | Transaction,
  params: UpdateLeaveGrantProposalStatusParams,
): Promise<LeaveGrantProposal | null> {
  const conditions = [eq(leaveGrantProposals.tenantId, params.tenantId), eq(leaveGrantProposals.id, params.id)];
  if (params.fromStatus !== undefined) {
    conditions.push(eq(leaveGrantProposals.status, params.fromStatus));
  }
  const [row] = await db
    .update(leaveGrantProposals)
    .set({
      status: params.status,
      decidedBy: params.decidedBy ?? null,
      decidedAt: params.decidedAt ?? null,
      decisionNote: params.decisionNote ?? null,
      grantId: params.grantId ?? null,
    })
    .where(and(...conditions))
    .returning();
  return row ?? null;
}

/**
 * まだ決裁されていない(proposed の)予告のうち、指定の基準日のものを superseded にする。
 * POST /leave/grants/auto が予告を経由せず付与を作ったときに呼ぶ(依頼の決定)。
 */
export async function supersedeProposedLeaveGrantProposals(
  db: Database | Transaction,
  params: { tenantId: string; userId: string; grantedOnDates: string[] },
): Promise<LeaveGrantProposal[]> {
  if (params.grantedOnDates.length === 0) return [];
  return db
    .update(leaveGrantProposals)
    .set({ status: "superseded" })
    .where(
      and(
        eq(leaveGrantProposals.tenantId, params.tenantId),
        eq(leaveGrantProposals.userId, params.userId),
        eq(leaveGrantProposals.status, "proposed"),
        inArray(leaveGrantProposals.grantedOn, params.grantedOnDates),
      ),
    )
    .returning();
}

/** ダッシュボードの「要対応」件数などに使う、proposed の件数(スコープ内ユーザーに絞れる)。 */
export async function countProposedLeaveGrantProposals(
  db: Database | Transaction,
  params: { tenantId: string; userIds?: string[] },
): Promise<number> {
  const rows = await listLeaveGrantProposals(db, {
    tenantId: params.tenantId,
    statuses: ["proposed"],
    ...(params.userIds !== undefined ? { userIds: params.userIds } : {}),
  });
  return rows.length;
}
