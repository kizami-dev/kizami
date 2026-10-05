/**
 * 退会したテナントの物理削除(2026-10-05)。設計は docs/design/tenant-withdrawal.md「物理削除」。
 *
 * 退職者の個人データの「消去」(queries/erasure.ts)は**行を残して匿名化する**操作だったが、
 * ここは逆に、そのテナントの**すべての行を消す**。労基法109条の保存義務は事業主(テナント)の
 * 義務であり、KIZAMI が行を消しても会社の義務は消えない — そのため退会の申請画面とメールで、
 * 削除の前に全データのエクスポートを保存するよう案内している(apps/api 側)。ここは消す操作だけを担う。
 *
 * ## 何を消すか
 *
 * - `TENANT_PURGE_ORDER` に並べた、tenant_id を持つ全テーブルの `tenant_id = 対象` の行
 *   (外部キーを持たない利用上限のカウンタ tenant_usage_counters も含む)
 * - システム表のうち tenants を参照する `pending_signups` の行(下記「システム表」)
 * - 最後に tenants の行そのもの
 *
 * **漏れを防ぐ仕組み**: 将来テーブルを足したとき、ここに載せ忘れると削除の対象から漏れる。
 * test/tenant-purge.test.ts がスキーマから tenant_id を持つテーブルと tenants を参照するテーブルを
 * すべて列挙し、`TENANT_PURGE_ORDER` / `TENANT_PURGE_SYSTEM_TABLES` のどちらにも載っていない
 * テーブルがあれば落ちる。外部キーの順序(子を親より先に消す)も同じテストがスキーマから検査する。
 *
 * ## システム表(docs/design/multi-tenancy.md「システム表の例外」)
 *
 * - `pending_signups.tenant_id`(確認完了後に作られたテナントの記録)は、**参照を外すのではなく行ごと
 *   消す**(判断点)。消費済みの行は申請者のメール・氏名・組織名をそのまま持っており、参照だけ null に
 *   すると「会社名と管理者のメール」が運用者側に残り続ける。行が消えても困るものは無い
 *   (招待コードの使用回数は signup_invite_codes.used_count に残る)。消した後も、同じメールで
 *   新しく登録できる(未消費の申請はメールごとに1行という部分 UNIQUE は、消費済みの行と無関係)
 * - `signup_invite_codes` / `password_reset_requests` / `worker_heartbeats` はテナントを参照しないので
 *   触らない(password_reset_requests はメールのキーを持つが、テナントとは結びつかず、定期ジョブが
 *   1日で消す)
 * - 削除の記録 `tenant_purge_records` は消さずに**作る**側(schema/tenant-purges.ts)
 *
 * ## トランザクションと D1(判断点)
 *
 * SQLite・PostgreSQL では全体を1トランザクションで行う(`transactional: true`、既定)。途中で
 * 失敗すれば何も消えていない状態に戻り、再実行で最初からやり直す。
 *
 * Cloudflare D1 は `BEGIN` を拒否する(docs/design/workers-d1.md)。D1 では `transactional: false` で、
 * **テーブルごとに1文ずつ**、外部キーの子から親の順に消す。この順なら途中で止まっても外部キー違反の
 * 状態にはならず(残るのは親の側だけ)、各テーブルの削除は「tenant_id が一致する行をすべて消す」
 * なので何度流しても同じ結果になる(冪等)。tenants の行は最後に消すので、途中で止まったテナントは
 * 「退会手続き中」のまま残り、再実行(定期ジョブの次の回、または運用者 CLI)で続きから完了する。
 * D1 の `batch()`(暗黙のトランザクション)にまとめる案は採らない: node-postgres に batch が無く
 * 実装が2系統になるうえ、削除は Workers のエントリからは走らない(定期ジョブも運用者 CLI も Node)。
 *
 * テーブル内の自己参照(punch_events.supersedes_id・departments.parent_id・shift_days.supersedes_id)は、
 * 同じテナントの行を1文で全部消すので問題にならない(SQLite も PostgreSQL も、NO ACTION の外部キーは
 * 文の終わりに検査する)。逆に、**別のテナントの行が対象テナントの行を参照していれば**外部キー違反で
 * 失敗する — テナント分離が破れているデータを黙って消し進めないための安全装置として、そのままにする。
 *
 * ## 行数の数え方
 *
 * 各テーブルで「数える → 消す」の順に2文を流す。DELETE の影響行数はドライバごとに取り方が違う
 * (libSQL / pg / D1)ので、ダイアレクトに依存しない COUNT を使う。トランザクションの中では
 * 数と削除が食い違うことはない。D1 では理論上ずれうるが、退会手続き中のテナントは書き込みが
 * 止まっている(apps/api の制限)ので、実際には一致する。
 */

import { count, eq, type Column } from "drizzle-orm";
import { getTableConfig, type SQLiteTable } from "drizzle-orm/sqlite-core";
import type { Database, Transaction } from "../types.js";
import {
  allowanceDefinitions,
  allowanceDefinitionVersions,
  apiKeys,
  approvalFlowSettings,
  auditLogs,
  authCredentials,
  autoBreakWaivers,
  closingEvents,
  closingSnapshots,
  correctionRequests,
  departments,
  helpOverrides,
  invitations,
  leaveGrantProposals,
  leaveGrants,
  leaveRequests,
  memberships,
  notifications,
  passwordResetTokens,
  pendingSignups,
  permissionPresets,
  presetAssignments,
  punchEvents,
  pushSubscriptions,
  scheduledHolidayCalendarVersions,
  sessions,
  shiftDays,
  shiftPatterns,
  shiftPlans,
  slackLinkTokens,
  slackUserLinks,
  tenantLeaveSettings,
  tenantNotificationSettings,
  tenantOidcSettings,
  tenantPurgeRecords,
  tenants,
  tenantSettingVersions,
  tenantSlackSettings,
  tenantUsageCounters,
  userNotificationSettings,
  userPolicyAssignments,
  users,
  userTotp,
  userTotpRecoveryCodes,
  workPolicies,
  workPolicyVersions,
} from "../schema/index.js";
import { uuidv7 } from "../uuid.js";
import { claimTenantPurge } from "./tenant-withdrawal.js";

/**
 * tenant_id を持つ全テーブルを、**外部キーの子 → 親**の順に並べたもの(削除の順序)。
 *
 * テーブルを足したらここにも足すこと(足し忘れは test/tenant-purge.test.ts が落とす)。
 * 位置は「そのテーブルを参照するテーブルより後ろ、そのテーブルが参照するテーブルより前」。
 * 順序の正しさも同じテストがスキーマの外部キーから検査する。
 */
export const TENANT_PURGE_ORDER: readonly SQLiteTable[] = [
  // 締め(closing_events は修正申請・休暇申請を参照する)
  closingSnapshots,
  closingEvents,
  // 打刻と申請(修正申請は打刻を参照する)
  correctionRequests,
  punchEvents,
  leaveGrantProposals,
  leaveGrants,
  leaveRequests,
  autoBreakWaivers,
  // シフト
  shiftDays,
  shiftPlans,
  shiftPatterns,
  // 組織・権限・制度
  memberships,
  departments,
  presetAssignments,
  permissionPresets,
  userPolicyAssignments,
  workPolicyVersions,
  workPolicies,
  allowanceDefinitionVersions,
  allowanceDefinitions,
  // users を参照するだけのもの(認証・通知・設定・監査ログ)
  apiKeys,
  approvalFlowSettings,
  auditLogs,
  authCredentials,
  helpOverrides,
  invitations,
  notifications,
  passwordResetTokens,
  pushSubscriptions,
  sessions,
  slackLinkTokens,
  slackUserLinks,
  tenantLeaveSettings,
  tenantNotificationSettings,
  tenantOidcSettings,
  tenantSlackSettings,
  userNotificationSettings,
  userTotpRecoveryCodes,
  userTotp,
  // テナントだけを参照するもの
  scheduledHolidayCalendarVersions,
  tenantSettingVersions,
  // 利用上限のカウンタ(docs/design/tenant-quotas.md)。外部キーは無いが tenant_id を持つので同じ経路で消し、
  // 削除の記録に行数を残す(queries/tenant-usage.ts の deleteTenantUsageCounters と同じ条件)
  tenantUsageCounters,
  // 最後に users(上のほぼすべてが参照している)
  users,
];

/**
 * tenant_id を持たない(またはテナントの所有ではない)のに、削除の対象テナントの行を
 * 持ちうる**システム表**と、その扱い。テナント行を消す直前に処理する。
 */
export const TENANT_PURGE_SYSTEM_TABLES: readonly { table: SQLiteTable; handling: "delete_rows" }[] = [
  // 参照を外さず行ごと消す理由はファイル冒頭「システム表」
  { table: pendingSignups, handling: "delete_rows" },
];

/** テーブルの SQL 上の名前(snake_case)。 */
export function tableNameOf(table: SQLiteTable): string {
  return getTableConfig(table).name;
}

/** テーブルの tenant_id 列(無ければ例外。TENANT_PURGE_ORDER には tenant_id を持つ表しか載せない)。 */
function tenantIdColumnOf(table: SQLiteTable): Column {
  const column = getTableConfig(table).columns.find((c) => c.name === "tenant_id");
  if (!column) throw new Error(`tenant-purge: ${tableNameOf(table)} has no tenant_id column`);
  return column;
}

export type TenantPurgeRecord = typeof tenantPurgeRecords.$inferSelect;

/** テーブル名 → 削除行数。 */
export type TenantPurgeCounts = Record<string, number>;

export interface PurgeTenantParams {
  tenantId: string;
  /** 削除の時刻(UTC エポック分) */
  now: number;
  /**
   * 削除予定の時刻を過ぎていることを「削除中」の印を取る条件に含めるか(既定 true)。
   * 定期ジョブは true、運用者 CLI の「今すぐ削除」だけが false(予定を待たない)。
   */
  requireDue?: boolean;
  /**
   * 1トランザクションで行うか(既定 true)。D1 では false にする(ファイル冒頭「トランザクションと D1」)。
   */
  transactional?: boolean;
  /**
   * テナント行を読んで「消してよいか」を確かめた直後、「削除中」の印を取る直前に呼ぶ(テスト用。
   * 確認と削除のすき間に取り消しが入る状況を作る)。本番のコードからは渡さない。
   */
  beforeClaim?: () => void | Promise<void>;
  /**
   * テーブルを1つ消すたびに呼ぶ(テスト用。途中で例外を投げて「途中で失敗した」状況を作る)。
   * 本番のコードからは渡さない。
   */
  afterTableDeleted?: (tableName: string) => void | Promise<void>;
}

export type PurgeTenantResult =
  /** 今回の実行で削除を完了した(途中から再開して完了した場合も含む) */
  | { status: "purged"; record: TenantPurgeRecord }
  /** 以前の実行で既に完了している(何もしていない) */
  | { status: "already_purged"; record: TenantPurgeRecord }
  /** 退会を申請していないテナント(何もしていない)。申請の無いテナントは決して消さない */
  | { status: "not_withdrawing" }
  /**
   * 「削除中」の印を取れなかった(確認の後に取り消された・削除予定の時刻の前)。何もしていない。
   * 迷ったら消さない側に倒す(ファイル冒頭「確認と削除のすき間」)
   */
  | { status: "not_claimed" }
  /** テナントも削除の記録も無い(存在しない id) */
  | { status: "not_found" };

/** 削除の途中で「削除中」の印が自分のものでなくなった(削除を止めた。トランザクションなら巻き戻る)。 */
export class TenantPurgeMarkerLostError extends Error {
  constructor(tenantId: string) {
    super(`purgeTenant: purge marker of tenant ${tenantId} changed during the purge; aborted`);
    this.name = "TenantPurgeMarkerLostError";
  }
}

/**
 * 退会を申請したテナントのすべての行を物理削除し、削除の記録(tenant_purge_records)を残す。
 *
 * ## 確認と削除のすき間(2026-10-05 セキュリティレビュー)
 *
 * 「申請中で予定を過ぎている」と確かめてから実際に消すまでの間に管理者が取り消すと、取り消した
 * テナントが消えうる。そこで削除は次の順で、**迷ったら消さない側**に倒す:
 *
 * 1. `claimTenantPurge` の条件付き UPDATE で「削除中」の印を取る(申請中・印が無い・予定を過ぎている、を
 *    すべて WHERE に含める)。取れなければ何もせず `not_claimed`。取り消しの側も「印が無い」を WHERE に
 *    含めるので、両者のどちらか一方だけが成功する。**印はトランザクションの外で確定させる** — 削除が途中で
 *    失敗しても印は残り、取り消しは効かず(409)、次の実行が印のあるテナントの削除を続ける
 * 2. 印が既にある(前回の実行が途中で止まった)なら、その印のまま続ける(冪等)
 * 3. テーブルを1つ消す前に毎回、テナント行の印が手順1・2で得た値のままであることを確かめる。
 *    違えば `TenantPurgeMarkerLostError` で止める(トランザクションなら何も消えない)
 *
 * 削除予定の時刻の判定は手順1の WHERE に入っている(`requireDue: false` の運用者 CLI だけが予定を待たない)。
 * 完了済みなら `already_purged` を返して何もしない。
 */
export async function purgeTenant(db: Database, params: PurgeTenantParams): Promise<PurgeTenantResult> {
  const { tenantId, now } = params;
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  if (!tenant) {
    const record = await findPurgeRecord(db, tenantId);
    if (!record) return { status: "not_found" };
    if (record.purgedAt !== null) return { status: "already_purged", record };
    // tenants 行を消した直後、記録を「完了」にする前に止まった(D1 のみ起こりうる)。
    // 消すものはもう無いので、記録を完了にして終える。
    const [completed] = await db.update(tenantPurgeRecords).set({ purgedAt: now }).where(eq(tenantPurgeRecords.id, record.id)).returning();
    return { status: "purged", record: completed ?? record };
  }
  if (tenant.withdrawalRequestedAt === null) return { status: "not_withdrawing" };

  let marker = tenant.withdrawalPurgeStartedAt;
  if (marker === null) {
    await params.beforeClaim?.();
    const claimed = await claimTenantPurge(db, { tenantId, now, requireDue: params.requireDue ?? true });
    if (!claimed || claimed.withdrawalPurgeStartedAt === null) return { status: "not_claimed" };
    marker = claimed.withdrawalPurgeStartedAt;
  }

  const run = (q: Database | Transaction) => purgeTenantSteps(q, params, marker);
  if (params.transactional === false) return run(db);
  return db.transaction(async (tx) => run(tx));
}

async function findPurgeRecord(q: Database | Transaction, tenantId: string): Promise<TenantPurgeRecord | null> {
  const [row] = await q.select().from(tenantPurgeRecords).where(eq(tenantPurgeRecords.tenantId, tenantId)).limit(1);
  return row ?? null;
}

/** 印を取った後の削除の本体。`marker` は自分が取った(または前回の実行が取った)「削除中」の印。 */
async function purgeTenantSteps(q: Database | Transaction, params: PurgeTenantParams, marker: number): Promise<PurgeTenantResult> {
  const { tenantId, now } = params;
  const [tenant] = await q.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  if (!tenant || tenant.withdrawalRequestedAt === null || tenant.withdrawalPurgeStartedAt !== marker) {
    throw new TenantPurgeMarkerLostError(tenantId);
  }

  let record = await findPurgeRecord(q, tenantId);
  if (!record) {
    const [inserted] = await q
      .insert(tenantPurgeRecords)
      .values({
        id: uuidv7(),
        tenantId,
        withdrawalRequestedAt: tenant.withdrawalRequestedAt,
        purgeStartedAt: marker,
        purgedAt: null,
        deletedCounts: "{}",
      })
      .returning();
    if (!inserted) throw new Error("purgeTenant: insert into tenant_purge_records returned no row");
    record = inserted;
  }
  const recordId = record.id;
  // 前回の途中までの行数に足し合わせる(D1 で途中から再開した場合。1トランザクションなら常に空から)
  const counts: TenantPurgeCounts = JSON.parse(record.deletedCounts) as TenantPurgeCounts;

  /** 次のテーブルを消す前に、「削除中」の印がまだ自分のものであることを確かめる。 */
  const assertMarker = async (): Promise<void> => {
    const [row] = await q
      .select({ requestedAt: tenants.withdrawalRequestedAt, startedAt: tenants.withdrawalPurgeStartedAt })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);
    if (!row || row.requestedAt === null || row.startedAt !== marker) throw new TenantPurgeMarkerLostError(tenantId);
  };

  const deleteWhere = async (table: SQLiteTable, column: Column, value: string): Promise<void> => {
    await assertMarker();
    const name = tableNameOf(table);
    const [row] = await q.select({ n: count() }).from(table).where(eq(column, value));
    await q.delete(table).where(eq(column, value));
    counts[name] = (counts[name] ?? 0) + (row?.n ?? 0);
    // テーブルごとに記録を更新する: D1 で途中で止まっても、そこまでに消した行数が残る
    await q.update(tenantPurgeRecords).set({ deletedCounts: JSON.stringify(counts) }).where(eq(tenantPurgeRecords.id, recordId));
    await params.afterTableDeleted?.(name);
  };

  for (const table of TENANT_PURGE_ORDER) {
    await deleteWhere(table, tenantIdColumnOf(table), tenantId);
  }
  for (const { table } of TENANT_PURGE_SYSTEM_TABLES) {
    await deleteWhere(table, tenantIdColumnOf(table), tenantId);
  }
  await deleteWhere(tenants, tenants.id, tenantId);

  const [completed] = await q
    .update(tenantPurgeRecords)
    .set({ purgedAt: now, deletedCounts: JSON.stringify(counts) })
    .where(eq(tenantPurgeRecords.id, recordId))
    .returning();
  if (!completed) throw new Error("purgeTenant: tenant_purge_records row vanished");
  return { status: "purged", record: completed };
}

/** 削除の記録を1件(運用者 CLI 用)。 */
export async function getTenantPurgeRecord(db: Database, tenantId: string): Promise<TenantPurgeRecord | null> {
  return findPurgeRecord(db, tenantId);
}

/** 削除の記録の一覧(新しい順。運用者 CLI 用)。 */
export async function listTenantPurgeRecords(db: Database): Promise<TenantPurgeRecord[]> {
  const rows = await db.select().from(tenantPurgeRecords);
  return rows.sort((a, b) => b.purgeStartedAt - a.purgeStartedAt || (a.id < b.id ? 1 : -1));
}
