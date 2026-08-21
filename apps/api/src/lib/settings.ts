/**
 * DB 上の effective-dated な設定行(tenant_setting_versions / work_policy_versions /
 * user_policy_assignments)を engine の SettingsSpan[] へ組み立てる。
 *
 * tenant_setting_versions は日界・法定休日・休憩ルール・GPS を持つが tzOffset は持たない
 * (docs/design/v01-data-model.md はテナントTZを Asia/Tokyo 前提と明記している)ため、
 * tzOffsetMinutes は本ファイルで固定値として扱う(判断点)。
 */

import { and, asc, eq } from "drizzle-orm";
import { getSettingsTimeline, userPolicyAssignments, workPolicyVersions, type Database } from "@kizami/db";
import type { CalcSettings, LegalHolidayRule, SettingsSpan } from "@kizami/engine";

/** Asia/Tokyo 固定(分)。テナントTZが設定可能になるのは v1.0 以降の想定。 */
export const TZ_OFFSET_MINUTES_JST = 540;

interface EffectiveDatedRow {
  effectiveFrom: string;
}

/** rows の中から effectiveFrom <= date の最新行を返す(rows の順序は問わない)。 */
function latestAtOrBefore<T extends EffectiveDatedRow>(rows: T[], date: string): T | null {
  let chosen: T | null = null;
  for (const row of rows) {
    if (row.effectiveFrom <= date && (chosen === null || row.effectiveFrom > chosen.effectiveFrom)) {
      chosen = row;
    }
  }
  return chosen;
}

export interface BuildSettingsTimelineParams {
  tenantId: string;
  userId: string;
  /** ローカル日付 "YYYY-MM-DD"(対象期間初日) */
  fromDate: string;
  /** ローカル日付 "YYYY-MM-DD"(対象期間末日) */
  toDate: string;
}

/**
 * [fromDate, toDate] をカバーする engine 用 SettingsSpan[] を組み立てる。
 *
 * 変更点(from 値)は「テナント設定の版」「ユーザーの制度割当」「割当先の制度の版」の
 * いずれかが変わりうる日の和集合とし、各変更点で3者を独立に(effectiveFrom <= date の
 * 最新行として)解決してマージする。
 */
export async function buildSettingsTimeline(db: Database, params: BuildSettingsTimelineParams): Promise<SettingsSpan[]> {
  const { tenantId, userId, fromDate, toDate } = params;

  const tenantTimeline = await getSettingsTimeline(db, { tenantId, fromDate, toDate });
  if (tenantTimeline.length === 0) {
    throw new Error(`no tenant settings version effective on or before ${fromDate}`);
  }

  const assignments = await db
    .select({
      effectiveFrom: userPolicyAssignments.effectiveFrom,
      workPolicyId: userPolicyAssignments.workPolicyId,
    })
    .from(userPolicyAssignments)
    .where(and(eq(userPolicyAssignments.tenantId, tenantId), eq(userPolicyAssignments.userId, userId)))
    .orderBy(asc(userPolicyAssignments.effectiveFrom));

  if (latestAtOrBefore(assignments, fromDate) === null) {
    throw new Error(`no work policy assigned to user ${userId} on or before ${fromDate}`);
  }

  const versions = await db
    .select({
      effectiveFrom: workPolicyVersions.effectiveFrom,
      workPolicyId: workPolicyVersions.workPolicyId,
      settlementPeriod: workPolicyVersions.settlementPeriod,
      standardDayMinutes: workPolicyVersions.standardDayMinutes,
    })
    .from(workPolicyVersions)
    .where(eq(workPolicyVersions.tenantId, tenantId))
    .orderBy(asc(workPolicyVersions.effectiveFrom));

  const changePoints = new Set<string>();
  for (const v of tenantTimeline) changePoints.add(v.effectiveFrom);
  for (const a of assignments) if (a.effectiveFrom <= toDate) changePoints.add(a.effectiveFrom);
  for (const v of versions) if (v.effectiveFrom <= toDate) changePoints.add(v.effectiveFrom);

  const sortedDates = [...changePoints].sort();

  return sortedDates.map((date): SettingsSpan => {
    const tenantVersion = latestAtOrBefore(tenantTimeline, date);
    if (!tenantVersion) {
      throw new Error(`no tenant settings resolvable at ${date}`);
    }
    const assignment = latestAtOrBefore(assignments, date);
    if (!assignment) {
      throw new Error(`no work policy assigned at ${date}`);
    }
    const version = latestAtOrBefore(
      versions.filter((v) => v.workPolicyId === assignment.workPolicyId),
      date,
    );
    if (!version) {
      throw new Error(`no work policy version resolvable for policy ${assignment.workPolicyId} at ${date}`);
    }

    const settings: CalcSettings = {
      tzOffsetMinutes: TZ_OFFSET_MINUTES_JST,
      dayBoundaryMinutes: tenantVersion.dayBoundaryMinutes,
      legalHoliday: JSON.parse(tenantVersion.legalHolidayRule) as LegalHolidayRule,
      flex: {
        settlement: version.settlementPeriod as "monthly",
        core: null,
        standardDayMinutes: version.standardDayMinutes,
      },
      breakRule: JSON.parse(tenantVersion.breakRule) as { mode: "punch" },
    };

    return { from: date, settings };
  });
}
