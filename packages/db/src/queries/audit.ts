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

import { and, desc, eq, gte, inArray, isNotNull, like, lt, lte, or, sql, type SQL } from "drizzle-orm";
import type { SQLiteColumn, SQLiteTable } from "drizzle-orm/sqlite-core";
import type { Database, Transaction } from "../types.js";
import {
  auditLogs,
  autoBreakWaivers,
  correctionRequests,
  leaveGrantProposals,
  leaveGrants,
  leaveRequests,
  shiftPlans,
  users,
} from "../schema/index.js";
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
  const [row] = await auditLogInsertQuery(db, input);
  if (!row) {
    throw new Error("insertAuditLog: insert returned no row");
  }
  return row;
}

/**
 * insertAuditLog と同じ行を作る insert ビルダを返す(実行しない)。アトミックな書き込み計画
 * (src/atomic.ts の `AtomicPlan.add`)へ監査ログを積むためのもの。
 */
export function auditLogInsertQuery(db: Database | Transaction, input: NewAuditLogInput) {
  return db
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
  /**
   * 部署スコープでの絞り込み(省略時はテナント全体)。下記 AuditLogScopeFilter 参照。
   * 2026-10-22(セキュリティ指摘 M7): 以前は audit_log.view を部署スコープで持つだけで
   * テナント全体の監査ログが読めていた。
   */
  scope?: AuditLogScopeFilter;
}

/**
 * 部署スコープの監査ログ閲覧者に見せる範囲。`userIds` / `departmentIds` は呼び出し側
 * (apps/api/src/lib/scope.ts の resolveAccessibleUserIds / resolveAccessibleDepartmentIds)が
 * 解決した「閲覧者が扱えるユーザー・部署」。
 *
 * 行が見える条件(どれか1つ):
 * 1. 対象(target)が扱えるユーザーに帰属する — `user:` / `users:` / `slack_user_links:` は
 *    id がそのままユーザーID、修正申請・休暇申請・休暇付与・付与提案・休憩自動控除の打ち消し・
 *    シフト計画は各テーブルの user_id(AUDIT_TARGET_OWNERS)
 * 2. 対象が扱える部署(`department:<id>`)
 * 3. 対象がユーザーか部署に帰属する行で、操作者(actor)が扱えるユーザー
 *
 * どのユーザー・部署にも帰属しない行(テナント設定・締め・APIキー・権限プリセット等の
 * テナント単位の記録)は部署スコープには見せない(テナント全体スコープのみ)。
 */
export interface AuditLogScopeFilter {
  userIds: readonly string[];
  departmentIds: readonly string[];
}

/**
 * target が `<prefix><id>` のとき、その行の持ち主ユーザーを引く表。`table` が無いものは
 * id 自体がユーザーID。ここに無い targetType はユーザーに帰属しない(テナント単位)扱い。
 * 新しい targetType で監査ログを書く経路を足したら、帰属先があればここにも足すこと。
 */
const AUDIT_TARGET_OWNERS: ReadonlyArray<{
  prefix: string;
  owner?: { table: SQLiteTable; id: SQLiteColumn; userId: SQLiteColumn; tenantId: SQLiteColumn };
}> = [
  { prefix: "user:" },
  { prefix: "users:" },
  { prefix: "slack_user_links:" },
  { prefix: "correction_request:", owner: { table: correctionRequests, id: correctionRequests.id, userId: correctionRequests.userId, tenantId: correctionRequests.tenantId } },
  { prefix: "leave_request:", owner: { table: leaveRequests, id: leaveRequests.id, userId: leaveRequests.userId, tenantId: leaveRequests.tenantId } },
  { prefix: "leave_grant:", owner: { table: leaveGrants, id: leaveGrants.id, userId: leaveGrants.userId, tenantId: leaveGrants.tenantId } },
  { prefix: "leave_grant_proposal:", owner: { table: leaveGrantProposals, id: leaveGrantProposals.id, userId: leaveGrantProposals.userId, tenantId: leaveGrantProposals.tenantId } },
  { prefix: "auto_break_waiver:", owner: { table: autoBreakWaivers, id: autoBreakWaivers.id, userId: autoBreakWaivers.userId, tenantId: autoBreakWaivers.tenantId } },
  { prefix: "shift_plans:", owner: { table: shiftPlans, id: shiftPlans.id, userId: shiftPlans.userId, tenantId: shiftPlans.tenantId } },
];

const DEPARTMENT_TARGET_PREFIX = "department:";

/** 固定の接頭辞(コード内の定数のみ)を SQL 文字列リテラルにする。束縛パラメータを増やさないため raw にする。 */
function literal(value: string): SQL {
  if (!/^[a-z_:]+$/.test(value)) throw new Error(`audit scope: unexpected literal ${value}`);
  return sql.raw(`'${value}'`);
}

/** `substr(target, 1, len(prefix)) = prefix`。LIKE は `_` がワイルドカードになるため使わない。 */
function targetHasPrefix(prefix: string): SQL {
  return sql`substr(${auditLogs.target}, 1, ${sql.raw(String(prefix.length))}) = ${literal(prefix)}`;
}

/** target の `<prefix>` より後ろ(= id)。substr は SQLite / PostgreSQL のどちらにもある。 */
function targetIdAfter(prefix: string): SQL {
  return sql`substr(${auditLogs.target}, ${sql.raw(String(prefix.length + 1))})`;
}

/**
 * 行の持ち主ユーザーID(帰属しない行は NULL)を返す SQL 式。持ち主の表は主キーで1行だけ引く
 * (相関サブクエリ)。定数は raw にしてあり、束縛パラメータを使わない(D1 は1文100個まで)。
 */
function targetOwnerUserIdExpr(): SQL {
  const branches = AUDIT_TARGET_OWNERS.map(({ prefix, owner }) => {
    const value = owner
      ? sql`(select ${owner.userId} from ${owner.table} where ${owner.id} = ${targetIdAfter(prefix)} and ${owner.tenantId} = ${auditLogs.tenantId})`
      : targetIdAfter(prefix);
    return sql`when ${targetHasPrefix(prefix)} then ${value}`;
  });
  return sql`(case ${sql.join(branches, sql` `)} else null end)`;
}

/**
 * D1 の束縛パラメータ上限(1文100個)に収まるよう、ユーザーID・部署IDを分けて問い合わせる
 * ときの1回あたりの件数。ユーザーは1回に2回(持ち主・操作者)使うので 40 × 2 = 80、
 * 残りは他の絞り込み条件(最大8個)の分。
 */
const SCOPE_USER_CHUNK = 40;
const SCOPE_DEPARTMENT_CHUNK = 80;

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export interface AuditLogWithActor extends AuditLog {
  actorName: string;
}

function baseConditions(filter: AuditLogListFilter): SQL[] {
  const conditions: SQL[] = [eq(auditLogs.tenantId, filter.tenantId)];
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
  return conditions;
}

function selectAuditLogs(db: Database, conditions: SQL[], limit: number): Promise<AuditLogWithActor[]> {
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
    .limit(limit);
}

export async function listAuditLogs(db: Database, filter: AuditLogListFilter): Promise<AuditLogWithActor[]> {
  const base = baseConditions(filter);
  if (filter.scope === undefined) return selectAuditLogs(db, base, filter.limit);

  // 部署スコープ: 見える条件(AuditLogScopeFilter のコメント)は「ユーザーの集合」「部署の集合」に
  // 対する OR なので、集合を分割して別々に問い合わせ、結果を合わせても同じ行の集合になる。
  // 各問い合わせが id 降順の先頭 limit 件を返すので、合わせて並べ直した先頭 limit 件が
  // 全体の先頭 limit 件と一致する(カーソルによるページングもそのまま正しい)。
  const owner = targetOwnerUserIdExpr();
  const attributable = or(isNotNull(owner), targetHasPrefix(DEPARTMENT_TARGET_PREFIX)) as SQL;
  const scopeConditions: SQL[] = [];
  for (const ids of chunk(filter.scope.userIds, SCOPE_USER_CHUNK)) {
    scopeConditions.push(or(inArray(owner, ids), and(inArray(auditLogs.actorId, ids), attributable)) as SQL);
  }
  for (const ids of chunk(filter.scope.departmentIds, SCOPE_DEPARTMENT_CHUNK)) {
    scopeConditions.push(
      inArray(
        auditLogs.target,
        ids.map((id) => `${DEPARTMENT_TARGET_PREFIX}${id}`),
      ),
    );
  }
  if (scopeConditions.length === 0) return [];

  const pages = await Promise.all(scopeConditions.map((scopeCondition) => selectAuditLogs(db, [...base, scopeCondition], filter.limit)));
  const byId = new Map<string, AuditLogWithActor>();
  for (const page of pages) for (const row of page) byId.set(row.id, row);
  return [...byId.values()].sort((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0)).slice(0, filter.limit);
}
