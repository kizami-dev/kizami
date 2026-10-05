/**
 * scheduled_holiday_calendar_versions(所定休日のカレンダー、effective-dated・追記専用)に対する
 * 最小限のクエリ層(2026-10-05、フレックスの契約上の枠)。
 *
 * tenant_setting_versions と同じ作法: UPDATE はせず、新しい版を足すことで変更を表す。
 * 過去日の禁止・同じ日の重複の禁止は呼び出し側(apps/api/src/routes/settings/holiday-calendar.ts)が
 * 検証する。JSON 列の中身もこの層では解釈しない。
 */

import { asc, eq } from "drizzle-orm";
import type { Database, Transaction } from "../types.js";
import { scheduledHolidayCalendarVersions } from "../schema/index.js";
import { uuidv7 } from "../uuid.js";

export type ScheduledHolidayCalendarVersion = typeof scheduledHolidayCalendarVersions.$inferSelect;

/**
 * テナントの全版を effective_from 昇順で返す。版の数は「カレンダーを変えた回数」に収まる想定なので、
 * 月次の計算でも期間で絞らずに全件を取り、呼び出し側で日付ごとに解決する
 * (work_policy_versions を fetchWorkPolicyVersionRowsForTenant で全件取るのと同じ判断)。
 */
export async function listScheduledHolidayCalendarVersions(
  db: Database | Transaction,
  tenantId: string,
): Promise<ScheduledHolidayCalendarVersion[]> {
  return db
    .select()
    .from(scheduledHolidayCalendarVersions)
    .where(eq(scheduledHolidayCalendarVersions.tenantId, tenantId))
    .orderBy(asc(scheduledHolidayCalendarVersions.effectiveFrom));
}

export interface InsertScheduledHolidayCalendarVersionParams {
  tenantId: string;
  /** ローカル日付 "YYYY-MM-DD"。この日から有効 */
  effectiveFrom: string;
  /** 曜日の JSON 文字列(例 "[0,6]") */
  weekdays: string;
  nationalHolidays: boolean;
  /** 日付の JSON 文字列 */
  extraHolidays: string;
  /** 日付の JSON 文字列 */
  extraWorkdays: string;
  /** UTC エポック分 */
  createdAt: number;
}

/** 新しい版を1件追記する(既存の版は一切変更しない)。 */
export async function insertScheduledHolidayCalendarVersion(
  db: Database | Transaction,
  params: InsertScheduledHolidayCalendarVersionParams,
): Promise<ScheduledHolidayCalendarVersion> {
  const [row] = await db
    .insert(scheduledHolidayCalendarVersions)
    .values({ id: uuidv7(), ...params })
    .returning();
  if (!row) {
    throw new Error("insertScheduledHolidayCalendarVersion: insert returned no row");
  }
  return row;
}
