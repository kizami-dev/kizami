/**
 * approval_flow_settings(多段承認のテナント単位設定)に対するクエリ層。
 * tenant_oidc_settings と同じ「テナントにつき1行・丸ごと置き換え」の形にそろえてある
 * (設計の正: docs/design/approval-flows.md)。
 */

import { eq } from "drizzle-orm";
import type { Database, Transaction } from "../migrate.js";
import { approvalFlowSettings } from "../schema/index.js";

export type ApprovalFlowSettings = typeof approvalFlowSettings.$inferSelect;

/** 承認段数を持つ申請の種別。DB 上は列名に対応する(行ではなく列で持つ理由は schema 側のコメント参照)。 */
export type ApprovalFlowKind = "correction" | "leave" | "auto_break_waiver";

/** 未設定テナントの既定値(スキーマの DEFAULT と一致させること)。全種別とも単段。 */
export const DEFAULT_APPROVAL_FLOW_STEPS = {
  correction: 1,
  leave: 1,
  auto_break_waiver: 1,
} as const satisfies Record<ApprovalFlowKind, number>;

/** 指定テナントの承認フロー設定を返す(未設定なら null — 呼び出し側は既定値=全種別1段として扱う)。 */
export async function getApprovalFlowSettings(
  db: Database | Transaction,
  tenantId: string,
): Promise<ApprovalFlowSettings | null> {
  const rows = await db.select().from(approvalFlowSettings).where(eq(approvalFlowSettings.tenantId, tenantId)).limit(1);
  return rows[0] ?? null;
}

export interface UpsertApprovalFlowSettingsInput {
  tenantId: string;
  correctionSteps: number;
  leaveSteps: number;
  autoBreakWaiverSteps: number;
  /** UTC エポック分 */
  updatedAt: number;
  updatedBy: string;
}

/** テナントの承認フロー設定を作成、または既存行を丸ごと置き換える(部分更新ではない)。 */
export async function upsertApprovalFlowSettings(
  db: Database | Transaction,
  input: UpsertApprovalFlowSettingsInput,
): Promise<ApprovalFlowSettings> {
  const values = {
    tenantId: input.tenantId,
    correctionSteps: input.correctionSteps,
    leaveSteps: input.leaveSteps,
    autoBreakWaiverSteps: input.autoBreakWaiverSteps,
    updatedAt: input.updatedAt,
    updatedBy: input.updatedBy,
  };

  const [row] = await db
    .insert(approvalFlowSettings)
    .values(values)
    .onConflictDoUpdate({ target: approvalFlowSettings.tenantId, set: values })
    .returning();
  if (!row) {
    throw new Error("upsertApprovalFlowSettings: insert/update returned no row");
  }
  return row;
}
