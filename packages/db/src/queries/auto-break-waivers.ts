/**
 * auto_break_waivers に対するクエリ層。
 *
 * correction_requests / leave_requests と同様、「ワークフローの現在状態」を持つ通常テーブルなので、
 * status の UPDATE を行う(設計上許される遷移は pending → approved/rejected/withdrawn のみ。
 * schema/auto-break-waivers.ts 参照)。二段承認(required_steps = 2)では pending →
 * approved_step1 → approved/rejected の中間状態を1つ挟む(docs/design/approval-flows.md)。
 */

import { and, asc, desc, eq, gte, inArray, lte } from "drizzle-orm";
import { AtomicPlan, runAtomic, type AtomicExecutor } from "../atomic.js";
import type { Database, Transaction } from "../types.js";
import { autoBreakWaivers } from "../schema/index.js";
import { uuidv7 } from "../uuid.js";
import { auditLogInsertQuery, type NewAuditLogInput } from "./audit.js";
import { closingSerializeKey, periodsOpenCondition } from "./closings.js";

export type AutoBreakWaiver = typeof autoBreakWaivers.$inferSelect;
export type AutoBreakWaiverStatus = "pending" | "approved_step1" | "approved" | "rejected" | "withdrawn";

export interface NewAutoBreakWaiverInput {
  tenantId: string;
  userId: string;
  requestedBy: string;
  /** ローカル日付 "YYYY-MM-DD"。打ち消す日 */
  waiveDate: string;
  reason: string;
  /**
   * 承認に必要な段数(1 = 単段 / 2 = 二段)。省略時は 1。作成時点のテナント設定を
   * 凍結して保存する(グランドファザリング。schema/corrections.ts のコメント参照)。
   */
  requiredSteps?: number;
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
      requiredSteps: input.requiredSteps ?? 1,
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
  status: "approved_step1" | "approved" | "rejected";
  decidedBy: string;
  /** UTC エポック分 */
  decidedAt: number;
  decisionNote?: string | null;
  /**
   * 遷移元の状態(楽観ロック)。省略時は "pending"。二段承認の二次承認では
   * "approved_step1" を渡す(docs/design/approval-flows.md)。
   */
  fromStatus?: AutoBreakWaiverStatus;
  /**
   * 二段承認の一次承認者・一次承認時刻。**渡したときだけ書き込む**(省略時は既存値を保つ)。
   * 二次承認・却下では省略することで、一次承認者の記録が消えないようにしている。
   */
  step1DecidedBy?: string;
  /** UTC エポック分 */
  step1DecidedAt?: number;
}

/**
 * pending(または fromStatus で指定した状態)の申請を approve/reject する。対象がその状態でない
 * (既に決定済み・取り下げ済み)場合は 0件更新となり null を返す(呼び出し側はこれを競合・
 * 二重操作の合図として扱う)。
 *
 * 一次承認(status = "approved_step1")では decided_by / decided_at は最終決裁の欄として
 * 空のまま残し、一次承認者は step1_decided_by / step1_decided_at に記録する。
 *
 * approved にする場合、同一 (tenantId, userId, waiveDate) の approved 重複は
 * schema 側の部分 UNIQUE index (auto_break_waivers_approved_unique_idx) が防ぐため、
 * ここでは事前チェックをせず UNIQUE 制約違反を呼び出し側(isUniqueConstraintError)に委ねる。
 */
export async function decideAutoBreakWaiver(db: Database | Transaction, params: DecideAutoBreakWaiverParams): Promise<AutoBreakWaiver | null> {
  const [row] = await autoBreakWaiverDecisionQuery(db, params);
  return row ?? null;
}

/** decideAutoBreakWaiver と同じ条件付き UPDATE のビルダ(実行しない。atomic plan 用)。 */
export function autoBreakWaiverDecisionQuery(q: AtomicExecutor, params: DecideAutoBreakWaiverParams) {
  // 一次承認は「最終決裁ではない」ので decided_by / decided_at を埋めない(承認済み表示や
  // 監査で「誰が決裁したか」を読むときに、一次承認者を最終決裁者と取り違えないため)。
  const isStep1 = params.status === "approved_step1";
  return q
    .update(autoBreakWaivers)
    .set({
      status: params.status,
      decidedBy: isStep1 ? null : params.decidedBy,
      decidedAt: isStep1 ? null : params.decidedAt,
      decisionNote: isStep1 ? null : (params.decisionNote ?? null),
      ...(params.step1DecidedBy !== undefined ? { step1DecidedBy: params.step1DecidedBy } : {}),
      ...(params.step1DecidedAt !== undefined ? { step1DecidedAt: params.step1DecidedAt } : {}),
    })
    .where(
      and(
        eq(autoBreakWaivers.id, params.id),
        eq(autoBreakWaivers.tenantId, params.tenantId),
        eq(autoBreakWaivers.status, params.fromStatus ?? "pending"),
      ),
    )
    .returning();
}

export interface DecideAutoBreakWaiverAtomicInput {
  /** 最終決裁(approved / rejected)だけ。一次承認は単文の decideAutoBreakWaiver + 監査ログのまま */
  decision: DecideAutoBreakWaiverParams & { status: "approved" | "rejected" };
  /**
   * 承認のとき、対象日の月("YYYY-MM")。まだ締められていないことを書き込みの条件にする
   * (締め済み月の承認 = amend は対象外)。却下では渡さない
   */
  openPeriod?: string;
  audit: NewAuditLogInput;
}

export type DecideAutoBreakWaiverAtomicResult =
  | { ok: true; waiver: AutoBreakWaiver }
  /** not_pending: 別の決裁・取り下げが先に入った / month_closed: 計画の前に読んだ後で対象月が締められた。何も書いていない */
  | { ok: false; reason: "not_pending" | "month_closed" };

/**
 * 休憩自動控除の打ち消し申請の最終承認・却下を1単位で行う: 状態の claim →(承認なら)対象月がまだ
 * 締められていないことの確認 → 監査ログ(atomic plan。D1 でも動く)。ガードと直列化は
 * approveCorrectionRequest(queries/corrections.ts)と同じ(docs/design/d1-atomic-writes.md §6 #18・#19)。
 *
 * 同じ (tenantId, userId, waiveDate) の approved の重複は、従来どおり部分 UNIQUE index
 * (auto_break_waivers_approved_unique_idx)が claim の UPDATE そのものを違反させる。`runAtomic` は
 * それを素通しするので、呼び出し側は isUniqueConstraintError で 409 にする(計画全体が巻き戻る)。
 */
export async function decideAutoBreakWaiverAtomic(
  db: Database,
  input: DecideAutoBreakWaiverAtomicInput,
): Promise<DecideAutoBreakWaiverAtomicResult> {
  const { decision, openPeriod } = input;
  const plan = new AtomicPlan();
  if (openPeriod !== undefined) plan.serialize(closingSerializeKey(decision.tenantId, openPeriod));
  const claim = plan.add((q) => autoBreakWaiverDecisionQuery(q, decision));
  plan.guard("auto_break_waiver.claim");
  if (openPeriod !== undefined) {
    plan.add((q) =>
      q
        .update(autoBreakWaivers)
        .set({ status: decision.status })
        .where(
          and(eq(autoBreakWaivers.id, decision.id), periodsOpenCondition(q, { tenantId: decision.tenantId, periods: [openPeriod] })),
        ),
    );
    plan.guard("auto_break_waiver.month_open");
  }
  plan.add((q) => auditLogInsertQuery(q, input.audit));

  const result = await runAtomic(db, plan);
  if (!result.ok) return { ok: false, reason: result.failedGuard === "auto_break_waiver.claim" ? "not_pending" : "month_closed" };
  const [waiver] = result.get(claim);
  if (!waiver) throw new Error("decideAutoBreakWaiverAtomic: the claim returned no row after the guard passed");
  return { ok: true, waiver };
}

export interface WithdrawAutoBreakWaiverParams {
  id: string;
  tenantId: string;
  /** 取り下げるのは申請者本人であることを呼び出し側で確認した上で渡す */
  userId: string;
}

/**
 * pending / approved_step1 の申請を本人が取り下げる。それ以外(既に決定済み)は 0件更新となり
 * null を返す。二段承認では**最終承認が下りるまで**取り下げられる
 * (docs/design/approval-flows.md「取り下げ」)。
 */
export async function withdrawAutoBreakWaiver(db: Database, params: WithdrawAutoBreakWaiverParams): Promise<AutoBreakWaiver | null> {
  const [row] = await db
    .update(autoBreakWaivers)
    .set({ status: "withdrawn" })
    .where(
      and(
        eq(autoBreakWaivers.id, params.id),
        eq(autoBreakWaivers.tenantId, params.tenantId),
        eq(autoBreakWaivers.userId, params.userId),
        inArray(autoBreakWaivers.status, ["pending", "approved_step1"]),
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
