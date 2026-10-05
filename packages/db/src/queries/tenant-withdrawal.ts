/**
 * テナントの退会(申請・取り消し・猶予期間の状態)のクエリ層(2026-10-05)。
 * 設計は docs/design/tenant-withdrawal.md。物理削除は queries/tenant-purge.ts、
 * 全データのエクスポートは queries/tenant-export.ts。
 *
 * 状態は tenants の3列(withdrawal_requested_at / withdrawal_scheduled_purge_at /
 * withdrawal_reminder_sent_at)だけで持つ(schema/tenants.ts のコメント参照)。
 * 申請・取り消しは**条件付き UPDATE の1文**で行い、二重申請・二重取り消しを DB で排他する
 * (先に SELECT して判定すると、同時のリクエストが両方とも通る)。
 *
 * ## 削除と取り消しの競合(2026-10-05 セキュリティレビュー)
 *
 * 削除は `claimTenantPurge` の条件付き UPDATE で「削除中」の印(withdrawal_purge_started_at)を取れた
 * ときだけ進み、取り消しは印が無いときだけ効く。どちらも同じ行への条件付き UPDATE なので、SQLite でも
 * PostgreSQL(行ロックで直列化され、後の側は WHERE を評価し直す)でも、どちらか一方しか成功しない。
 * 「確認した後・削除する前」に取り消しが入れば、印は取れず、何も消えない(削除しない側に倒れる)。
 */

import { and, asc, eq, isNotNull, isNull, lte, or } from "drizzle-orm";
import type { Database, Transaction } from "../types.js";
import { tenants } from "../schema/index.js";
import type { Tenant } from "./tenants.js";

export interface RequestTenantWithdrawalParams {
  tenantId: string;
  /** 申請の時刻(UTC エポック分) */
  requestedAt: number;
  /** 削除を始めてよくなる時刻(UTC エポック分)。呼び出し側が猶予期間を足して渡す */
  scheduledPurgeAt: number;
}

/**
 * 退会を申請する(通常の状態 → 退会手続き中)。既に手続き中なら null(何も変えない)。
 * 呼び出し側(apps/api/src/routes/tenant-withdrawal.ts)が監査ログを書く。
 */
export async function requestTenantWithdrawal(
  db: Database | Transaction,
  params: RequestTenantWithdrawalParams,
): Promise<Tenant | null> {
  const [row] = await db
    .update(tenants)
    .set({
      withdrawalRequestedAt: params.requestedAt,
      withdrawalScheduledPurgeAt: params.scheduledPurgeAt,
      withdrawalReminderSentAt: null,
      withdrawalPurgeStartedAt: null,
    })
    .where(and(eq(tenants.id, params.tenantId), isNull(tenants.withdrawalRequestedAt)))
    .returning();
  return row ?? null;
}

/**
 * 退会の申請を取り消す(退会手続き中 → 通常の状態)。手続き中でない、または**削除が始まっている**
 * (「削除中」の印がある)なら null(何も変えない)。どちらだったかは呼び出し側がテナント行を読み直して区別する。
 * 列をすべて null に戻すので、取り消した後にもう一度申請すれば猶予期間は申請の時点から数え直す。
 */
export async function cancelTenantWithdrawal(db: Database | Transaction, params: { tenantId: string }): Promise<Tenant | null> {
  const [row] = await db
    .update(tenants)
    .set({ withdrawalRequestedAt: null, withdrawalScheduledPurgeAt: null, withdrawalReminderSentAt: null })
    .where(
      and(eq(tenants.id, params.tenantId), isNotNull(tenants.withdrawalRequestedAt), isNull(tenants.withdrawalPurgeStartedAt)),
    )
    .returning();
  return row ?? null;
}

/**
 * 「削除中」の印を原子的に取る。条件(退会を申請中・まだ削除中でない・`requireDue` なら削除予定の時刻を
 * 過ぎている)をすべて WHERE に含めた1文の UPDATE で、更新できたときだけ行を返す(できなければ null =
 * 取り消された・予定前・別の実行が先に取った)。印を取った後は取り消しが効かない。
 */
export async function claimTenantPurge(
  db: Database | Transaction,
  params: { tenantId: string; now: number; requireDue: boolean },
): Promise<Tenant | null> {
  const conditions = [
    eq(tenants.id, params.tenantId),
    isNotNull(tenants.withdrawalRequestedAt),
    isNull(tenants.withdrawalPurgeStartedAt),
  ];
  if (params.requireDue) conditions.push(lte(tenants.withdrawalScheduledPurgeAt, params.now));
  const [row] = await db
    .update(tenants)
    .set({ withdrawalPurgeStartedAt: params.now })
    .where(and(...conditions))
    .returning();
  return row ?? null;
}

/** 退会手続き中のテナントの id の一覧(定期ジョブの対象から外すために使う)。 */
export async function listWithdrawingTenantIds(db: Database): Promise<string[]> {
  const rows = await db.select({ id: tenants.id }).from(tenants).where(isNotNull(tenants.withdrawalRequestedAt));
  return rows.map((r) => r.id);
}

/**
 * 削除予定の時刻を過ぎた(= 物理削除してよい)退会手続き中のテナントと、削除を始めたが終わっていない
 * (「削除中」の印がある)テナント。予定の早い順。ここで選ばれても、実際に消すかどうかは
 * `claimTenantPurge` の条件付き UPDATE で決まる(この一覧を読んだ後の取り消しは削除に勝つ)。
 */
export async function listTenantsDueForPurge(db: Database, params: { now: number }): Promise<Tenant[]> {
  return db
    .select()
    .from(tenants)
    .where(
      and(
        isNotNull(tenants.withdrawalRequestedAt),
        or(lte(tenants.withdrawalScheduledPurgeAt, params.now), isNotNull(tenants.withdrawalPurgeStartedAt)),
      ),
    )
    .orderBy(asc(tenants.withdrawalScheduledPurgeAt), asc(tenants.id));
}

/**
 * 削除の再通知(削除予定の `leadMinutes` 前)を送るべきテナント: 手続き中・未送信・再通知の時刻を過ぎた・
 * まだ削除予定の時刻になっていない。
 */
export async function listTenantsDueForWithdrawalReminder(
  db: Database,
  params: { now: number; leadMinutes: number },
): Promise<Tenant[]> {
  const rows = await db
    .select()
    .from(tenants)
    .where(and(isNotNull(tenants.withdrawalRequestedAt), isNull(tenants.withdrawalReminderSentAt), isNull(tenants.withdrawalPurgeStartedAt)))
    .orderBy(asc(tenants.withdrawalScheduledPurgeAt), asc(tenants.id));
  return rows.filter(
    (t) =>
      t.withdrawalScheduledPurgeAt !== null &&
      t.withdrawalScheduledPurgeAt - params.leadMinutes <= params.now &&
      params.now < t.withdrawalScheduledPurgeAt,
  );
}

/**
 * 再通知を送った印を付ける。条件付き UPDATE なので、同じテナントに対して true を返すのは1回だけ
 * (定期ジョブが重なって走っても、メールは1通)。印を付けてから送る — 送信に失敗しても再送はしない
 * (再通知は案内であって、申請時のメールと画面の表示が主。二重送信のほうが不審に見える)。
 */
export async function markWithdrawalReminderSent(db: Database, params: { tenantId: string; sentAt: number }): Promise<boolean> {
  const rows = await db
    .update(tenants)
    .set({ withdrawalReminderSentAt: params.sentAt })
    .where(and(eq(tenants.id, params.tenantId), isNotNull(tenants.withdrawalRequestedAt), isNull(tenants.withdrawalReminderSentAt)))
    .returning({ id: tenants.id });
  return rows.length > 0;
}
