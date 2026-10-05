/**
 * テナントごとの利用上限(docs/design/tenant-quotas.md)が使うクエリ。
 *
 * - `consumeTenantDailyCounter`: 日次カウンタを**上限つきで原子的に +1**(1文の UPSERT)。同時に何本来ても上限を超えない
 * - `incrementTenantCounter`: 上限なしの +1(上限に達して断った回数 `hit:*` の記録用)
 * - `countActiveMembers` / `countActiveApiKeys`: 現在の数(メンバー数・API キー数の上限の判定用)
 * - `sumQuotaLimitHits`: `/metrics` の「上限に達した回数」(テナントを区別しない全体の累計)
 * - `deleteTenantUsageCounters`: テナントの退会時にカウンタを消す(テーブルは外部キーを持たない。schema/tenant-usage.ts)
 */

import { and, count, eq, gt, isNull, like, or, sql } from "drizzle-orm";
import { apiKeys, tenantUsageCounters, users } from "../schema/index.js";
import type { Database, Transaction } from "../types.js";

/** 日本時間の日番号(UTC エポック分 → 日)。日次カウンタは日本時間の 0 時に切り替わる。 */
export function usageDayFromMinutes(epochMinutes: number): number {
  return Math.floor((epochMinutes + 9 * 60) / 1440);
}

/** 上限に達して断った回数のカウンタ種別(`hit:<limit>`)。 */
export const QUOTA_HIT_PREFIX = "hit:";

export interface ConsumeDailyCounterParams {
  tenantId: string;
  counterKey: string;
  /** `usageDayFromMinutes` の値 */
  day: number;
  /** 1日の上限。これを超える +1 は行わない */
  limit: number;
}

export interface ConsumeDailyCounterResult {
  /** +1 できた(上限内)か。false なら何も書いていない */
  allowed: boolean;
  /** 許可した場合の +1 後の値。拒否した場合は 0(正確な現在値は返さない) */
  count: number;
}

/**
 * 日次カウンタを上限つきで +1 する。
 *
 * `INSERT ... ON CONFLICT DO UPDATE SET count = count + 1 WHERE count < limit` の1文で、
 * 判定と加算が不可分(同時に何本来ても、上限を超えて加算されない。SQLite・PostgreSQL・D1 で成り立つ)。
 * `limit <= 0` は書き込まずに拒否する。
 */
export async function consumeTenantDailyCounter(
  db: Database | Transaction,
  params: ConsumeDailyCounterParams,
): Promise<ConsumeDailyCounterResult> {
  if (params.limit <= 0) return { allowed: false, count: 0 };
  const [row] = await db
    .insert(tenantUsageCounters)
    .values({ tenantId: params.tenantId, counterKey: params.counterKey, day: params.day, count: 1 })
    .onConflictDoUpdate({
      target: [tenantUsageCounters.tenantId, tenantUsageCounters.counterKey, tenantUsageCounters.day],
      set: { count: sql`${tenantUsageCounters.count} + 1` },
      setWhere: sql`${tenantUsageCounters.count} < ${params.limit}`,
    })
    .returning({ count: tenantUsageCounters.count });
  return row ? { allowed: true, count: row.count } : { allowed: false, count: 0 };
}

/** カウンタを上限なしで +1 する(戻り値は +1 後の値)。 */
export async function incrementTenantCounter(
  db: Database | Transaction,
  params: { tenantId: string; counterKey: string; day: number },
): Promise<number> {
  const [row] = await db
    .insert(tenantUsageCounters)
    .values({ tenantId: params.tenantId, counterKey: params.counterKey, day: params.day, count: 1 })
    .onConflictDoUpdate({
      target: [tenantUsageCounters.tenantId, tenantUsageCounters.counterKey, tenantUsageCounters.day],
      set: { count: sql`${tenantUsageCounters.count} + 1` },
    })
    .returning({ count: tenantUsageCounters.count });
  return row?.count ?? 0;
}

/** あるテナントの、ある日のカウンタの値(無ければ 0)。 */
export async function getTenantDailyCounter(
  db: Database,
  params: { tenantId: string; counterKey: string; day: number },
): Promise<number> {
  const [row] = await db
    .select({ count: tenantUsageCounters.count })
    .from(tenantUsageCounters)
    .where(
      and(
        eq(tenantUsageCounters.tenantId, params.tenantId),
        eq(tenantUsageCounters.counterKey, params.counterKey),
        eq(tenantUsageCounters.day, params.day),
      ),
    );
  return row?.count ?? 0;
}

/**
 * 在籍者の数(`is_active` かつ未消去)。**招待中(受諾前)のメンバーも含む** — 招待した時点で users 行が
 * できて席を占めるため(受諾を待たないと数えない仕様だと、招待だけ大量に出して上限を回避できる)。
 */
export async function countActiveMembers(db: Database | Transaction, tenantId: string): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(users)
    .where(and(eq(users.tenantId, tenantId), eq(users.isActive, true), isNull(users.erasedAt)));
  return row?.value ?? 0;
}

/** 有効な(失効していない・期限切れでない)API キーの数。 */
export async function countActiveApiKeys(db: Database | Transaction, params: { tenantId: string; nowMinutes: number }): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(apiKeys)
    .where(
      and(
        eq(apiKeys.tenantId, params.tenantId),
        isNull(apiKeys.revokedAt),
        or(isNull(apiKeys.expiresAt), gt(apiKeys.expiresAt, params.nowMinutes)),
      ),
    );
  return row?.value ?? 0;
}

/**
 * 上限に達して断った回数の累計(全テナント合計)。キーは上限の名前(`members` など。`hit:` は外す)。
 * `/metrics` が出す。行は日×テナントごとなので、集計は counter_key の索引を使う1クエリ。
 */
export async function sumQuotaLimitHits(db: Database): Promise<Record<string, number>> {
  const rows = await db
    .select({ key: tenantUsageCounters.counterKey, total: sql<number>`sum(${tenantUsageCounters.count})` })
    .from(tenantUsageCounters)
    .where(like(tenantUsageCounters.counterKey, `${QUOTA_HIT_PREFIX}%`))
    .groupBy(tenantUsageCounters.counterKey);
  const result: Record<string, number> = {};
  for (const row of rows) result[row.key.slice(QUOTA_HIT_PREFIX.length)] = Number(row.total);
  return result;
}

/** テナントのカウンタを全部消す(退会時用。テーブルは外部キーを持たないので、呼ばなくても削除は妨げられない)。 */
export async function deleteTenantUsageCounters(db: Database | Transaction, tenantId: string): Promise<void> {
  await db.delete(tenantUsageCounters).where(eq(tenantUsageCounters.tenantId, tenantId));
}
