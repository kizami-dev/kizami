/**
 * 有給休暇管理(§5)のクエリ層。tenant_leave_settings / leave_grants / leave_requests。
 */

import { and, asc, desc, eq, gte, lte } from "drizzle-orm";
import type { Database, Transaction } from "../migrate.js";
import { leaveGrants, leaveRequests, tenantLeaveSettings } from "../schema/index.js";
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
export type LeaveRequestStatus = "pending" | "approved" | "rejected" | "withdrawn";

export interface NewLeaveRequestInput {
  tenantId: string;
  userId: string;
  requestedBy: string;
  leaveDate: string;
  unit: string;
  minutes?: number | null;
  leaveType: string;
  reason: string;
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

/** GET /attendance/monthly の paidLeave 組み立て、および残高・年5日計算の入力に使う。 */
export async function listApprovedLeaveRequestsInRange(
  db: Database,
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

/** 同日の重複申請チェック(pending/approved)に使う。unit ごとの衝突判定は呼び出し側(routes/leave.ts)で行う。 */
export async function listActiveLeaveRequestsForDate(
  db: Database,
  params: { tenantId: string; userId: string; leaveDate: string },
): Promise<LeaveRequest[]> {
  const rows = await db
    .select()
    .from(leaveRequests)
    .where(and(eq(leaveRequests.tenantId, params.tenantId), eq(leaveRequests.userId, params.userId), eq(leaveRequests.leaveDate, params.leaveDate)));
  return rows.filter((r) => r.status === "pending" || r.status === "approved");
}

export interface UpdateLeaveRequestStatusParams {
  id: string;
  tenantId: string;
  fromStatus?: LeaveRequestStatus;
  status: LeaveRequestStatus;
  decidedBy?: string | null;
  decidedAt?: number | null;
  decisionNote?: string | null;
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
      decisionNote: params.decisionNote ?? null,
    })
    .where(and(...conditions))
    .returning();
  return row ?? null;
}
