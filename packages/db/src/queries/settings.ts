/**
 * tenant_setting_versions(effective-dated, 追記専用)に対する最小限のクエリ層。
 */

import { and, asc, desc, eq, gte, lte } from "drizzle-orm";
import type { Database } from "../migrate.js";
import { tenantSettingVersions } from "../schema/index.js";

export type TenantSettingVersion = typeof tenantSettingVersions.$inferSelect;

export interface GetEffectiveSettingsVersionParams {
  tenantId: string;
  /** ローカル日付 "YYYY-MM-DD" */
  onDate: string;
}

/** effective_from <= onDate の最新版を1件返す(存在しなければ null)。 */
export async function getEffectiveSettingsVersion(
  db: Database,
  params: GetEffectiveSettingsVersionParams,
): Promise<TenantSettingVersion | null> {
  const rows = await db
    .select()
    .from(tenantSettingVersions)
    .where(and(eq(tenantSettingVersions.tenantId, params.tenantId), lte(tenantSettingVersions.effectiveFrom, params.onDate)))
    .orderBy(desc(tenantSettingVersions.effectiveFrom))
    .limit(1);
  return rows[0] ?? null;
}

export interface GetSettingsTimelineParams {
  tenantId: string;
  /** ローカル日付 "YYYY-MM-DD"(期間初日) */
  fromDate: string;
  /** ローカル日付 "YYYY-MM-DD"(期間末日) */
  toDate: string;
}

/**
 * 期間に関係する版列を effective_from 昇順で返す:
 * 「期間初日(fromDate)以前の最新版1件」+「期間内([fromDate, toDate])の版全部」。
 * 前者と後者が同一行になる場合(ちょうど fromDate 始まりの版がある場合)は重複させない。
 */
export async function getSettingsTimeline(db: Database, params: GetSettingsTimelineParams): Promise<TenantSettingVersion[]> {
  const latestBeforeOrOnFrom = await getEffectiveSettingsVersion(db, { tenantId: params.tenantId, onDate: params.fromDate });

  const withinPeriod = await db
    .select()
    .from(tenantSettingVersions)
    .where(
      and(
        eq(tenantSettingVersions.tenantId, params.tenantId),
        gte(tenantSettingVersions.effectiveFrom, params.fromDate),
        lte(tenantSettingVersions.effectiveFrom, params.toDate),
      ),
    )
    .orderBy(asc(tenantSettingVersions.effectiveFrom));

  const alreadyIncluded = latestBeforeOrOnFrom !== null && withinPeriod.some((v) => v.id === latestBeforeOrOnFrom.id);
  const combined = latestBeforeOrOnFrom !== null && !alreadyIncluded ? [latestBeforeOrOnFrom, ...withinPeriod] : withinPeriod;

  return [...combined].sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? -1 : a.effectiveFrom > b.effectiveFrom ? 1 : 0));
}
