/**
 * audit_logs(追記専用)への読み書きクエリ。
 *
 * 打刻の監査は punch_events 自体が担うため、ここに書き込むのは打刻以外の変更に限る
 * (docs/design/v01-data-model.md §audit_logs)。読み取り(listAuditLogs)は
 * `GET /audit-logs`(Tier 1、監査ログは読み取り専用 — 更新・削除は絶対に作らない。
 * 不可変性が要件)専用。
 *
 * 判断点: audit_logs スキーマ(packages/db/src/schema/audit.ts)は action + target(単一カラム)+
 * before/after ダイジェストという構成で、依頼にあった targetType/targetId/detail の3分割は
 * 持たない。ここでは呼び出し側の使いやすさを優先し、targetType/targetId を
 * `target = "<targetType>:<targetId>"` に、detail(JSON 文字列)を afterDigest に
 * マッピングして既存スキーマへ書き込む(insertAuditLog)。読み取り側(listAuditLogs)もこの
 * 合成規則に沿ってフィルタ条件を組み立てる。
 */

import { and, desc, eq, gte, like, lt, lte } from "drizzle-orm";
import type { Database, Transaction } from "../migrate.js";
import { auditLogs, users } from "../schema/index.js";
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

/**
 * GET /audit-logs(Tier 1, apps/api/src/routes/audit-logs.ts)向けの絞り込み+ページング読み取り。
 *
 * `target` カラムは `${targetType}:${targetId}` の合成文字列(insertAuditLog 参照)なので、
 * targetType/targetId の指定に応じて完全一致 or 前方一致/後方一致の LIKE に変換する。
 * カーソルは `id`(UUIDv7、時系列ソート可能)を使う — occurred_at は分単位で同時刻の行が
 * 複数ありえるため、ページ境界の重複・取りこぼしを避けるには一意な id での keyset の方が安全
 * (schema/audit.ts の audit_logs_tenant_id_idx 参照)。
 */
export interface AuditLogListFilter {
  tenantId: string;
  actorId?: string;
  targetType?: string;
  targetId?: string;
  action?: string;
  /** UTC エポック分。閉区間 */
  fromMinutes?: number;
  toMinutes?: number;
  /** 直前ページ最後の行の id。指定した場合、その行より新しい(id が小さい)行から返す */
  cursor?: string;
  limit: number;
}

export interface AuditLogWithActor extends AuditLog {
  actorName: string;
}

export async function listAuditLogs(db: Database, filter: AuditLogListFilter): Promise<AuditLogWithActor[]> {
  const conditions = [eq(auditLogs.tenantId, filter.tenantId)];
  if (filter.actorId !== undefined) conditions.push(eq(auditLogs.actorId, filter.actorId));
  if (filter.action !== undefined) conditions.push(eq(auditLogs.action, filter.action));
  if (filter.targetType !== undefined && filter.targetId !== undefined) {
    conditions.push(eq(auditLogs.target, `${filter.targetType}:${filter.targetId}`));
  } else if (filter.targetType !== undefined) {
    conditions.push(like(auditLogs.target, `${filter.targetType}:%`));
  } else if (filter.targetId !== undefined) {
    conditions.push(like(auditLogs.target, `%:${filter.targetId}`));
  }
  if (filter.fromMinutes !== undefined) conditions.push(gte(auditLogs.occurredAt, filter.fromMinutes));
  if (filter.toMinutes !== undefined) conditions.push(lte(auditLogs.occurredAt, filter.toMinutes));
  if (filter.cursor !== undefined) conditions.push(lt(auditLogs.id, filter.cursor));

  return db
    .select({
      id: auditLogs.id,
      tenantId: auditLogs.tenantId,
      actorId: auditLogs.actorId,
      action: auditLogs.action,
      target: auditLogs.target,
      beforeDigest: auditLogs.beforeDigest,
      afterDigest: auditLogs.afterDigest,
      occurredAt: auditLogs.occurredAt,
      actorName: users.name,
    })
    .from(auditLogs)
    .innerJoin(users, eq(auditLogs.actorId, users.id))
    .where(and(...conditions))
    .orderBy(desc(auditLogs.id))
    .limit(filter.limit);
}
