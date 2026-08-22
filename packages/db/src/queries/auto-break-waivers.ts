/**
 * auto_break_waivers に対するクエリ層。
 *
 * correction_requests / leave_requests と同様、「ワークフローの現在状態」を持つ通常テーブルなので、
 * status の UPDATE を行う(設計上許される遷移は pending → approved/rejected/withdrawn のみ。
 * schema/auto-break-waivers.ts 参照)。
 */

import { and, asc, desc, eq, gte, lte } from "drizzle-orm";
import type { Database, Transaction } from "../migrate.js";
import { autoBreakWaivers } from "../schema/index.js";
import { uuidv7 } from "../uuid.js";

export type AutoBreakWaiver = typeof autoBreakWaivers.$inferSelect;
export type AutoBreakWaiverStatus = "pending" | "approved" | "rejected" | "withdrawn";

export interface NewAutoBreakWaiverInput {
  tenantId: string;
  userId: string;
  requestedBy: string;
  /** ローカル日付 "YYYY-MM-DD"。打ち消す日 */
  waiveDate: string;
  reason: string;
  /** UTC エポック分 */
  createdAt: number;
}

/** auto_break_waivers へ1件作成する。status は常に 'pending' で始まる。 */
export async function createAutoBreakWaiver(db: Database, input: NewAutoBreakWaiverInput): Promise<AutoBreakWaiver> {
  const [row] = await db
    .insert(autoBreakWaivers)
    .values({
      id: uuidv7(),
      tenantId: input.tenantId,
      userId: input.userId,
      requestedBy: input.requestedBy,
      status: "pending",
      waiveDate: input.waiveDate,
      reason: input.reason,
      createdAt: input.createdAt,
    })
    .returning();
  if (!row) {
    throw new Error("createAutoBreakWaiver: insert returned no row");
  }
  return row;
}

/** id から1件取得する(tenant スコープはしない。呼び出し側で tenantId 一致を確認すること)。 */
export async function getAutoBreakWaiverById(db: Database, id: string): Promise<AutoBreakWaiver | null> {
  const rows = await db.select().from(autoBreakWaivers).where(eq(autoBreakWaivers.id, id)).limit(1);
  return rows[0] ?? null;
}

export interface ListAutoBreakWaiversParams {
  tenantId: string;
  userId?: string;
  status?: AutoBreakWaiverStatus;
}

/** (tenantId, userId?, status?) で絞り込み、新しい順(created_at, id の降順)で返す。一覧画面向け。 */
export async function listAutoBreakWaivers(db: Database, params: ListAutoBreakWaiversParams): Promise<AutoBreakWaiver[]> {
  const conditions = [eq(autoBreakWaivers.tenantId, params.tenantId)];
  if (params.userId !== undefined) {
    conditions.push(eq(autoBreakWaivers.userId, params.userId));
  }
  if (params.status !== undefined) {
    conditions.push(eq(autoBreakWaivers.status, params.status));
  }

  return db
    .select()
    .from(autoBreakWaivers)
    .where(and(...conditions))
    .orderBy(desc(autoBreakWaivers.createdAt), desc(autoBreakWaivers.id));
}

export interface DecideAutoBreakWaiverParams {
  id: string;
  tenantId: string;
  status: "approved" | "rejected";
  decidedBy: string;
  /** UTC エポック分 */
  decidedAt: number;
  decisionNote?: string | null;
}

/**
 * pending の申請を approve/reject する。対象が pending でない(既に決定済み・取り下げ済み)場合は
 * 0件更新となり null を返す(呼び出し側はこれを競合・二重操作の合図として扱う)。
 *
 * approved にする場合、同一 (tenantId, userId, waiveDate) の approved 重複は
 * schema 側の部分 UNIQUE index (auto_break_waivers_approved_unique_idx) が防ぐため、
 * ここでは事前チェックをせず UNIQUE 制約違反を呼び出し側(isUniqueConstraintError)に委ねる。
 */
export async function decideAutoBreakWaiver(db: Database | Transaction, params: DecideAutoBreakWaiverParams): Promise<AutoBreakWaiver | null> {
  const [row] = await db
    .update(autoBreakWaivers)
    .set({
      status: params.status,
      decidedBy: params.decidedBy,
      decidedAt: params.decidedAt,
      decisionNote: params.decisionNote ?? null,
    })
    .where(and(eq(autoBreakWaivers.id, params.id), eq(autoBreakWaivers.tenantId, params.tenantId), eq(autoBreakWaivers.status, "pending")))
    .returning();
  return row ?? null;
}

export interface WithdrawAutoBreakWaiverParams {
  id: string;
  tenantId: string;
  /** 取り下げるのは申請者本人であることを呼び出し側で確認した上で渡す */
  userId: string;
}

/** pending の申請を本人が取り下げる。pending 以外(既に決定済み)は 0件更新となり null を返す。 */
export async function withdrawAutoBreakWaiver(db: Database, params: WithdrawAutoBreakWaiverParams): Promise<AutoBreakWaiver | null> {
  const [row] = await db
    .update(autoBreakWaivers)
    .set({ status: "withdrawn" })
    .where(
      and(
        eq(autoBreakWaivers.id, params.id),
        eq(autoBreakWaivers.tenantId, params.tenantId),
        eq(autoBreakWaivers.userId, params.userId),
        eq(autoBreakWaivers.status, "pending"),
      ),
    )
    .returning();
  return row ?? null;
}

/**
 * 承認済みの打ち消し日を範囲取得し、waive_date の配列で返す。
 *
 * 集計エンジンの `autoBreakWaivedDates`(docs/design/breaks.md「採る設計」参照)にそのまま渡すための
 * 関数: 承認済みの日は自動控除の入力から除外される。`Database | Transaction` を受け取るのは
 * 締め後修正などが同一トランザクション内で月次を再計算するケースに備えるため(leave.ts の
 * listApprovedLeaveRequestsInRange と同じ理由)。
 */
export async function listApprovedWaiverDatesInRange(
  db: Database | Transaction,
  params: { tenantId: string; userId: string; fromDate: string; toDate: string },
): Promise<string[]> {
  const rows = await db
    .select({ waiveDate: autoBreakWaivers.waiveDate })
    .from(autoBreakWaivers)
    .where(
      and(
        eq(autoBreakWaivers.tenantId, params.tenantId),
        eq(autoBreakWaivers.userId, params.userId),
        eq(autoBreakWaivers.status, "approved"),
        gte(autoBreakWaivers.waiveDate, params.fromDate),
        lte(autoBreakWaivers.waiveDate, params.toDate),
      ),
    )
    .orderBy(asc(autoBreakWaivers.waiveDate));
  return rows.map((r) => r.waiveDate);
}
