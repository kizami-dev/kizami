/**
 * correction_requests に対するクエリ層。
 *
 * punch_events と異なり correction_requests は「ワークフローの現在状態」を持つ通常テーブルなので、
 * status の UPDATE を行う(設計上許される遷移は pending → approved/rejected/withdrawn のみ。
 * §correction_requests 参照)。二段承認(required_steps = 2)では pending → approved_step1 →
 * approved/rejected の中間状態を1つ挟む(docs/design/approval-flows.md)。
 */

import { and, desc, eq } from "drizzle-orm";
import type { Database, Transaction } from "../migrate.js";
import { correctionRequests } from "../schema/index.js";
import { uuidv7 } from "../uuid.js";

export type CorrectionRequest = typeof correctionRequests.$inferSelect;
export type CorrectionStatus = "pending" | "approved_step1" | "approved" | "rejected" | "withdrawn";

export interface NewCorrectionRequestInput {
  tenantId: string;
  userId: string;
  requestedBy: string;
  targetEventId?: string | null;
  proposedKind?: string | null;
  proposedOccurredAt?: number | null;
  reason: string;
  /**
   * 承認に必要な段数(1 = 単段 / 2 = 二段)。省略時は 1。作成時点のテナント設定を
   * 凍結して保存する(グランドファザリング。schema/corrections.ts のコメント参照)。
   */
  requiredSteps?: number;
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
      requiredSteps: input.requiredSteps ?? 1,
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
  /**
   * 二段承認の一次承認者・一次承認時刻。**渡したときだけ書き込む**(省略時は既存値を保つ)。
   * 二次承認・却下では省略することで、一次承認者の記録が消えないようにしている。
   */
  step1DecidedBy?: string;
  /** UTC エポック分 */
  step1DecidedAt?: number;
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
      ...(params.step1DecidedBy !== undefined ? { step1DecidedBy: params.step1DecidedBy } : {}),
      ...(params.step1DecidedAt !== undefined ? { step1DecidedAt: params.step1DecidedAt } : {}),
    })
    .where(and(...conditions))
    .returning();
  return row ?? null;
}
