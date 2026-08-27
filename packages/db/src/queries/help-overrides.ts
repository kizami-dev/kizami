/**
 * help_overrides に対するクエリ層。
 *
 * 1テナント×1ヘルプキーにつき最新の1件を保持する現在値テーブル(改訂履歴は持たない)。
 * getHelpOverrides はキーで引ける Record 形で返す(呼び出し側 — apps/api/src/routes/help.ts —
 * が @kizami/help-content の HELP と突き合わせやすいように)。
 */

import { and, eq } from "drizzle-orm";
import type { Database, Transaction } from "../types.js";
import { helpOverrides } from "../schema/index.js";

export type HelpOverride = typeof helpOverrides.$inferSelect;

/** 指定テナントの全 help_overrides を helpKey → 行 の Record で返す(0件なら空オブジェクト)。 */
export async function getHelpOverrides(db: Database | Transaction, tenantId: string): Promise<Record<string, HelpOverride>> {
  const rows = await db.select().from(helpOverrides).where(eq(helpOverrides.tenantId, tenantId));
  const result: Record<string, HelpOverride> = {};
  for (const row of rows) {
    result[row.helpKey] = row;
  }
  return result;
}

/** 指定テナント・ヘルプキーの1件を返す(未設定なら null)。 */
export async function getHelpOverride(db: Database | Transaction, tenantId: string, helpKey: string): Promise<HelpOverride | null> {
  const rows = await db
    .select()
    .from(helpOverrides)
    .where(and(eq(helpOverrides.tenantId, tenantId), eq(helpOverrides.helpKey, helpKey)))
    .limit(1);
  return rows[0] ?? null;
}

export interface UpsertHelpOverrideInput {
  tenantId: string;
  helpKey: string;
  bodyMd: string;
  updatedBy: string;
  /** UTC エポック分 */
  updatedAt: number;
}

/** 作成、または既存行を丸ごと置き換える(PK は (tenant_id, help_key))。 */
export async function upsertHelpOverride(db: Database | Transaction, input: UpsertHelpOverrideInput): Promise<HelpOverride> {
  const values = {
    tenantId: input.tenantId,
    helpKey: input.helpKey,
    bodyMd: input.bodyMd,
    updatedBy: input.updatedBy,
    updatedAt: input.updatedAt,
  };

  const [row] = await db
    .insert(helpOverrides)
    .values(values)
    .onConflictDoUpdate({ target: [helpOverrides.tenantId, helpOverrides.helpKey], set: values })
    .returning();
  if (!row) {
    throw new Error("upsertHelpOverride: insert/update returned no row");
  }
  return row;
}

/** 指定テナント・ヘルプキーの上書きを削除する(存在しなくてもエラーにしない)。 */
export async function deleteHelpOverride(db: Database | Transaction, tenantId: string, helpKey: string): Promise<void> {
  await db.delete(helpOverrides).where(and(eq(helpOverrides.tenantId, tenantId), eq(helpOverrides.helpKey, helpKey)));
}
