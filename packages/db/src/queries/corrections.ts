/**
 * correction_requests に対するクエリ層。
 *
 * punch_events と異なり correction_requests は「ワークフローの現在状態」を持つ通常テーブルなので、
 * status の UPDATE を行う(設計上許される遷移は pending → approved/rejected/withdrawn のみ。
 * §correction_requests 参照)。
 */

import { and, desc, eq } from "drizzle-orm";
import type { Database, Transaction } from "../migrate.js";
import { correctionRequests } from "../schema/index.js";
import { uuidv7 } from "../uuid.js";

export type CorrectionRequest = typeof correctionRequests.$inferSelect;
export type CorrectionStatus = "pending" | "approved" | "rejected" | "withdrawn";

export interface NewCorrectionRequestInput {
  tenantId: string;
  userId: string;
  requestedBy: string;
  targetEventId?: string | null;
  proposedKind?: string | null;
  proposedOccurredAt?: number | null;
  reason: string;
  /** UTC エポック分 */
  createdAt: number;
}

/** correction_requests へ1件作成する。status は常に 'pending' で始まる。 */
export async function createCorrectionRequest(db: Database, input: NewCorrectionRequestInput): Promise<CorrectionRequest> {
  const [row] = await db
    .insert(correctionRequests)
    .values({
      id: uuidv7(),
      tenantId: input.tenantId,
      userId: input.userId,
      requestedBy: input.requestedBy,
      status: "pending",
      targetEventId: input.targetEventId ?? null,
      proposedKind: input.proposedKind ?? null,
      proposedOccurredAt: input.proposedOccurredAt ?? null,
      reason: input.reason,
      createdAt: input.createdAt,
    })
    .returning();
  if (!row) {
    throw new Error("createCorrectionRequest: insert returned no row");
  }
  return row;
}

export interface ListCorrectionRequestsParams {
  tenantId: string;
  userId?: string;
  status?: CorrectionStatus;
}

/** (tenantId, userId?, status?) で絞り込み、新しい順(created_at, id の降順)で返す。 */
export async function listCorrectionRequests(db: Database, params: ListCorrectionRequestsParams): Promise<CorrectionRequest[]> {
  const conditions = [eq(correctionRequests.tenantId, params.tenantId)];
  if (params.userId !== undefined) {
    conditions.push(eq(correctionRequests.userId, params.userId));
  }
  if (params.status !== undefined) {
    conditions.push(eq(correctionRequests.status, params.status));
  }

  return db
    .select()
    .from(correctionRequests)
    .where(and(...conditions))
    .orderBy(desc(correctionRequests.createdAt), desc(correctionRequests.id));
}

/** id から1件取得する(tenant スコープはしない。呼び出し側で tenantId 一致を確認すること)。 */
export async function getCorrectionRequest(db: Database, id: string): Promise<CorrectionRequest | null> {
  const rows = await db.select().from(correctionRequests).where(eq(correctionRequests.id, id)).limit(1);
  return rows[0] ?? null;
}

export interface UpdateCorrectionStatusParams {
  id: string;
  tenantId: string;
  /** 指定した場合、現在の status がこれと一致する行のみ更新する(楽観ロック) */
  fromStatus?: CorrectionStatus;
  status: CorrectionStatus;
  decidedBy?: string | null;
  /** UTC エポック分 */
  decidedAt?: number | null;
  decisionNote?: string | null;
}

/**
 * status を更新する。`fromStatus` を渡すと「現在その状態である行」だけを対象にした
 * 条件付き UPDATE になり、0件更新(= 既に別状態へ遷移済み)なら null を返す。
 * 呼び出し側(承認・却下エンドポイント)はこれを競合・二重操作の合図として扱う。
 */
export async function updateCorrectionStatus(
  db: Database | Transaction,
  params: UpdateCorrectionStatusParams,
): Promise<CorrectionRequest | null> {
  const conditions = [eq(correctionRequests.id, params.id), eq(correctionRequests.tenantId, params.tenantId)];
  if (params.fromStatus !== undefined) {
    conditions.push(eq(correctionRequests.status, params.fromStatus));
  }

  const [row] = await db
    .update(correctionRequests)
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
