/**
 * tenant_setting_versions(effective-dated, 追記専用)に対する最小限のクエリ層。
 */

import { and, asc, desc, eq, gte, lte } from "drizzle-orm";
import type { Database, Transaction } from "../migrate.js";
import { tenantSettingVersions } from "../schema/index.js";
import { uuidv7 } from "../uuid.js";

export type TenantSettingVersion = typeof tenantSettingVersions.$inferSelect;

export interface GetEffectiveSettingsVersionParams {
  tenantId: string;
  /** ローカル日付 "YYYY-MM-DD" */
  onDate: string;
}

/**
 * effective_from <= onDate の最新版を1件返す(存在しなければ null)。
 *
 * `Database | Transaction` を受け取る(apps/api/src/lib/closing-amend.ts が締め後修正の
 * 反映と同一トランザクションで月次を再計算するために必要 — 経由する
 * buildSettingsTimeline/getSettingsTimeline も同じ理由で widen してある)。
 */
export async function getEffectiveSettingsVersion(
  db: Database | Transaction,
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
export async function getSettingsTimeline(db: Database | Transaction, params: GetSettingsTimelineParams): Promise<TenantSettingVersion[]> {
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

/**
 * テナントの全版を effective_from 昇順で返す(版の履歴表示・編集画面の GET /settings/attendance 用)。
 * 追記専用テーブルなので全件返しても件数は「変更した回数」に収まる想定。
 */
export async function listTenantSettingVersions(db: Database | Transaction, tenantId: string): Promise<TenantSettingVersion[]> {
  return db
    .select()
    .from(tenantSettingVersions)
    .where(eq(tenantSettingVersions.tenantId, tenantId))
    .orderBy(asc(tenantSettingVersions.effectiveFrom));
}

export interface InsertTenantSettingVersionParams {
  tenantId: string;
  /** ローカル日付 "YYYY-MM-DD"。この日から有効 */
  effectiveFrom: string;
  dayBoundaryMinutes: number;
  /** LegalHolidayRule の JSON 文字列 */
  legalHolidayRule: string;
  /** breakRule の JSON 文字列 */
  breakRule: string;
  gpsEnabled: boolean;
  gpsRetentionDays: number | null;
  /** 週の起算曜日(0=日曜)。固定時間制で「週40時間超」を判定する起点。呼び出し側が明示する */
  weekStartWeekday: number;
  /** UTC エポック分 */
  createdAt: number;
}

/**
 * 新しい版を1件追記する(UPDATE ではない — 既存の版は一切変更しない)。
 * 過去日禁止・重複禁止のバリデーションは呼び出し側(apps/api/src/routes/settings.ts)が行う
 * (原則6: 編集UIは新しい版を追加しかできない。docs/design/v01-data-model.md 参照)。
 */
export async function insertTenantSettingVersion(
  db: Database | Transaction,
  params: InsertTenantSettingVersionParams,
): Promise<TenantSettingVersion> {
  const [row] = await db
    .insert(tenantSettingVersions)
    .values({
      id: uuidv7(),
      tenantId: params.tenantId,
      effectiveFrom: params.effectiveFrom,
      dayBoundaryMinutes: params.dayBoundaryMinutes,
      legalHolidayRule: params.legalHolidayRule,
      breakRule: params.breakRule,
      gpsEnabled: params.gpsEnabled,
      gpsRetentionDays: params.gpsRetentionDays,
      weekStartWeekday: params.weekStartWeekday,
      createdAt: params.createdAt,
    })
    .returning();
  if (!row) {
    throw new Error("insertTenantSettingVersion: insert returned no row");
  }
  return row;
}
