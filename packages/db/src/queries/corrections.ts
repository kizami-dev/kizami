/**
 * correction_requests に対するクエリ層。
 *
 * punch_events と異なり correction_requests は「ワークフローの現在状態」を持つ通常テーブルなので、
 * status の UPDATE を行う(設計上許される遷移は pending → approved/rejected/withdrawn のみ。
 * §correction_requests 参照)。二段承認(required_steps = 2)では pending → approved_step1 →
 * approved/rejected の中間状態を1つ挟む(docs/design/approval-flows.md)。
 */

import { and, desc, eq } from "drizzle-orm";
import { AtomicPlan, runAtomic, type AtomicExecutor } from "../atomic.js";
import type { Database, Transaction } from "../types.js";
import { correctionRequests } from "../schema/index.js";
import { uuidv7 } from "../uuid.js";
import { auditLogInsertQuery, type NewAuditLogInput } from "./audit.js";
import { closingSerializeKey, periodsOpenCondition } from "./closings.js";
import { punchEventInsertQuery, type NewPunchEvent, type PunchEvent } from "./punches.js";

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
  const [row] = await correctionStatusUpdateQuery(db, params);
  return row ?? null;
}

/** updateCorrectionStatus と同じ条件付き UPDATE のビルダ(実行しない。atomic plan に積むためのもの)。 */
export function correctionStatusUpdateQuery(q: AtomicExecutor, params: UpdateCorrectionStatusParams) {
  const conditions = [eq(correctionRequests.id, params.id), eq(correctionRequests.tenantId, params.tenantId)];
  if (params.fromStatus !== undefined) {
    conditions.push(eq(correctionRequests.status, params.fromStatus));
  }
  return q
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
}

export interface ApproveCorrectionRequestInput {
  id: string;
  tenantId: string;
  /** 楽観ロックの遷移元(単段なら "pending"、二段の二次承認なら "approved_step1") */
  fromStatus: CorrectionStatus;
  decidedBy: string;
  /** UTC エポック分 */
  decidedAt: number;
  decisionNote: string | null;
  /** 反映する打刻(訂正・追加・取消)。id は呼び出し側で決める(監査ログの appliedEventId に使うため) */
  punch: NewPunchEvent & { id: string };
  /**
   * 影響する月("YYYY-MM")。**どれも締められていないことを書き込みの条件にする**(締め済み月の承認 =
   * amend はこの関数の対象外 — 呼び出し側が計画の前に締め状態を読んで振り分ける)
   */
  openPeriods: readonly string[];
  audit: NewAuditLogInput;
}

export type ApproveCorrectionRequestResult =
  | { ok: true; request: CorrectionRequest; event: PunchEvent }
  /** not_pending: 別の決裁が先に入った / month_closed: 計画の前に読んだ後で対象月が締められた。どちらも何も書いていない */
  | { ok: false; reason: "not_pending" | "month_closed" };

/**
 * 締め前の月への修正申請の最終承認を1単位で行う: 状態の claim → 「対象月がまだ締められていない」の
 * 確認 → 打刻の追記 → 監査ログ(src/atomic.ts の atomic plan。D1 でも動く)。
 *
 * 判断点(2026-10-08、D1 対応。docs/design/d1-atomic-writes.md §6 #14):
 * - **claim を先頭に置く**。以前の tx は「打刻 insert → 状態 update(0件なら throw)」の順だった。
 *   追加(targetEventId 無し)の打刻には UNIQUE が無く、同時の二重承認を DB の制約では止められない。
 *   ガードは計画全体を巻き戻すのでどちらの順でも打刻は残らないが、claim を先にしておけば
 *   「負けた側が打刻を1行でも書く」瞬間そのものが無い(fail-closed の上に、順序でも閉じる)
 * - 締めの再確認は **同じ行への2本目の条件付き UPDATE(status を同じ値で上書き)+ ガード**で表す。
 *   claim の WHERE に混ぜるとガードが1本になり、「先に決裁された」と「締められた」を区別できない
 *   (前者は 409、後者は呼び出し側が amend の経路へ回す)。SQLite の `changes()` も PostgreSQL の
 *   rowCount も値が変わらない UPDATE を1行と数える
 * - PostgreSQL では対象月ごとに closePeriod と同じキーで直列化する(src/atomic.ts「直列化キー」)。
 *   同時の締めのコミット前に条件を評価して「まだ open」と誤判定しないため。キーは昇順に取り、
 *   複数月の承認同士で待ち合いの順序が食い違わないようにする
 * - 訂正・取消の二重 supersede は従来どおり punch_events.supersedes_id の UNIQUE 違反として投げる
 *   (`runAtomic` は素通しする。呼び出し側が isUniqueConstraintError で 409 already_superseded にする)
 */
export async function approveCorrectionRequest(
  db: Database,
  input: ApproveCorrectionRequestInput,
): Promise<ApproveCorrectionRequestResult> {
  const periods = [...new Set(input.openPeriods)].sort();
  const plan = new AtomicPlan();
  for (const period of periods) plan.serialize(closingSerializeKey(input.tenantId, period));
  const claim = plan.add((q) =>
    correctionStatusUpdateQuery(q, {
      id: input.id,
      tenantId: input.tenantId,
      fromStatus: input.fromStatus,
      status: "approved",
      decidedBy: input.decidedBy,
      decidedAt: input.decidedAt,
      decisionNote: input.decisionNote,
    }),
  );
  plan.guard("correction.claim");
  if (periods.length > 0) {
    plan.add((q) =>
      q
        .update(correctionRequests)
        .set({ status: "approved" })
        .where(and(eq(correctionRequests.id, input.id), periodsOpenCondition(q, { tenantId: input.tenantId, periods }))),
    );
    plan.guard("correction.month_open");
  }
  const inserted = plan.add((q) => punchEventInsertQuery(q, input.punch));
  plan.add((q) => auditLogInsertQuery(q, input.audit));

  const result = await runAtomic(db, plan);
  if (!result.ok) return { ok: false, reason: result.failedGuard === "correction.claim" ? "not_pending" : "month_closed" };
  const [request] = result.get(claim);
  const [event] = result.get(inserted);
  if (!request || !event) throw new Error("approveCorrectionRequest: a statement returned no row after the guards passed");
  return { ok: true, request, event };
}

export interface RejectCorrectionRequestInput {
  id: string;
  tenantId: string;
  /** 楽観ロックの遷移元(pending / approved_step1) */
  fromStatus: CorrectionStatus;
  decidedBy: string;
  /** UTC エポック分 */
  decidedAt: number;
  decisionNote: string | null;
  audit: NewAuditLogInput;
}

/**
 * 修正申請を却下する: 状態の claim → 監査ログを1単位で(atomic plan。D1 でも動く)。
 * claim できなければ null(先に別の決裁・取り下げが入った。監査ログも残らない)。
 */
export async function rejectCorrectionRequest(db: Database, input: RejectCorrectionRequestInput): Promise<CorrectionRequest | null> {
  const plan = new AtomicPlan();
  const claim = plan.add((q) =>
    correctionStatusUpdateQuery(q, {
      id: input.id,
      tenantId: input.tenantId,
      fromStatus: input.fromStatus,
      status: "rejected",
      decidedBy: input.decidedBy,
      decidedAt: input.decidedAt,
      decisionNote: input.decisionNote,
    }),
  );
  plan.guard("correction.claim");
  plan.add((q) => auditLogInsertQuery(q, input.audit));
  const result = await runAtomic(db, plan);
  if (!result.ok) return null;
  return result.get(claim)[0] ?? null;
}
