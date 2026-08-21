/**
 * audit_logs(追記専用)への書き込みクエリ。
 *
 * 打刻の監査は punch_events 自体が担うため、ここに書くのは打刻以外の変更
 * (v0.2 第一弾では修正申請の承認・却下)に限る(docs/design/v01-data-model.md §audit_logs)。
 *
 * 判断点: audit_logs スキーマ(packages/db/src/schema/audit.ts)は action + target(単一カラム)+
 * before/after ダイジェストという構成で、依頼にあった targetType/targetId/detail の3分割は
 * 持たない。ここでは呼び出し側の使いやすさを優先し、targetType/targetId を
 * `target = "<targetType>:<targetId>"` に、detail(JSON 文字列)を afterDigest に
 * マッピングして既存スキーマへ書き込む。
 */

import type { Database, Transaction } from "../migrate.js";
import { auditLogs } from "../schema/index.js";
import { uuidv7 } from "../uuid.js";

export type AuditLog = typeof auditLogs.$inferSelect;

export interface NewAuditLogInput {
  tenantId: string;
  actorId: string;
  action: string;
  targetType: string;
  targetId: string;
  /** JSON 文字列。DB 層は中身を解釈しない */
  detail: string;
  /** UTC エポック分 */
  occurredAt: number;
}

/**
 * audit_logs へ1件追記する。punch_events への反映と同一トランザクションで書けるよう
 * `Database | Transaction` を受け取る。
 */
export async function insertAuditLog(db: Database | Transaction, input: NewAuditLogInput): Promise<AuditLog> {
  const [row] = await db
    .insert(auditLogs)
    .values({
      id: uuidv7(),
      tenantId: input.tenantId,
      actorId: input.actorId,
      action: input.action,
      target: `${input.targetType}:${input.targetId}`,
      afterDigest: input.detail,
      occurredAt: input.occurredAt,
    })
    .returning();
  if (!row) {
    throw new Error("insertAuditLog: insert returned no row");
  }
  return row;
}
