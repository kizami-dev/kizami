/**
 * GET /settings/holiday-calendar, POST /settings/holiday-calendar
 *
 * 所定休日のカレンダー(2026-10-05、時短勤務の第2段階)。フレックスの契約上の枠
 * (所定労働日数 × 標準労働時間)で「どの日が所定労働日か」を決める。総労働時間の決め方が
 * 法定の枠(既定)の制度には効かないので、このカレンダーを変えても既存のテナントの数字は変わらない。
 *
 * 作法は GET/POST /settings/attendance(日界・法定休日・休憩)と同じ:
 * - 追記専用の版(effective-dated)。過去日は 409 effective_from_in_past、同じ日の版は
 *   409 version_already_exists。過去の集計は変わらない
 * - 権限は勤怠ルールと同じ `tenant_settings.calendar.manage`(テナント全体)
 * - 監査ログは `scheduled_holiday_calendar_version.create`(detail に前後の版)
 *
 * 法定休日との関係: 法定休日(労基法35条)は所定休日の一部で、このカレンダーとは別に
 * /settings/attendance が持つ。所定労働日を数えるときは、このカレンダーに関係なく法定休日を
 * 必ず休日にする(packages/engine の calendar.ts)。
 *
 * 版が1つも無いテナントは engine の既定(土日・国民の祝日)で数える。GET はそのとき
 * `effective: null` と、既定の中身(`defaults`)を返す。
 */

import type { Hono } from "hono";
import {
  getSettingsTimeline,
  insertAuditLog,
  insertScheduledHolidayCalendarVersion,
  listScheduledHolidayCalendarVersions,
  type Database,
  type ScheduledHolidayCalendarVersion,
} from "@kizami/db";
import {
  DEFAULT_SCHEDULED_HOLIDAY_CALENDAR,
  listScheduledWorkDates,
  type BreakRule,
  type LegalHolidayRule,
  type ScheduledHolidayCalendar,
  type SettingsSpan,
  type Weekday,
} from "@kizami/engine";
import { NATIONAL_HOLIDAY_DATA_RANGE } from "@kizami/law";
import type { AppEnv } from "../../auth/middleware.js";
import { requirePermission } from "../../authz.js";
import { parseCalendarVersion } from "../../lib/holiday-calendar.js";
import { TZ_OFFSET_MINUTES_JST } from "../../lib/settings.js";
import { dateFromEpochDay, daysInMonth, epochDayFromDate, formatDate, nowMinutes, todayLocalDate } from "../../lib/time.js";
import { ATTENDANCE_CALENDAR_PERMISSION } from "./permissions.js";
import { isValidLocalDate, parseJsonRecord, type SettingsRoutesDeps } from "./shared.js";

/** 個別に追加・除外する日付の上限(それぞれ)。1年分の毎日を書いても収まる数 */
const MAX_CALENDAR_DATES = 366;

/** 所定労働日数の目安を返す月数(今月から) */
const PREVIEW_MONTHS = 3;

function serializeCalendarVersion(v: ScheduledHolidayCalendarVersion) {
  return { effectiveFrom: v.effectiveFrom, ...parseCalendarVersion(v), createdAt: v.createdAt };
}

/**
 * リクエストの本文からカレンダーを検証して取り出す。
 * - weekdays: 0〜6 の整数の配列(重複は1つにまとめる)。7曜日すべては「所定労働日が1日も無い」
 *   設定ミスなので拒否する。空配列(曜日による休みなし)は許す
 * - nationalHolidays: boolean
 * - extraHolidays / extraWorkdays: "YYYY-MM-DD" の配列(各 366 件まで)。同じ日を両方に入れるのは
 *   どちらの意図か分からないため拒否する(400 calendar_date_conflict)
 */
function parseCalendar(body: Record<string, unknown>): ScheduledHolidayCalendar | { error: string } {
  const { weekdays, nationalHolidays, extraHolidays, extraWorkdays } = body;
  if (!Array.isArray(weekdays) || !weekdays.every((w) => Number.isInteger(w) && w >= 0 && w <= 6)) {
    return { error: "invalid_weekdays" };
  }
  const uniqueWeekdays = [...new Set(weekdays as Weekday[])].sort((a, b) => a - b);
  if (uniqueWeekdays.length === 7) return { error: "invalid_weekdays" };

  if (typeof nationalHolidays !== "boolean") return { error: "invalid_national_holidays" };

  const parseDates = (value: unknown): string[] | null => {
    if (value === undefined) return [];
    if (!Array.isArray(value) || value.length > MAX_CALENDAR_DATES || !value.every((d) => isValidLocalDate(d))) return null;
    return [...new Set(value as string[])].sort();
  };
  const holidays = parseDates(extraHolidays);
  if (holidays === null) return { error: "invalid_extra_holidays" };
  const workdays = parseDates(extraWorkdays);
  if (workdays === null) return { error: "invalid_extra_workdays" };
  if (holidays.some((d) => workdays.includes(d))) return { error: "calendar_date_conflict" };

  return { weekdays: uniqueWeekdays, nationalHolidays, extraHolidays: holidays, extraWorkdays: workdays };
}

/**
 * 所定労働日数の目安(今月から PREVIEW_MONTHS か月)。画面で「この設定だと何日になるか」を
 * 見せるためのもので、法定休日は今日時点のテナント設定で判定する(人ごとの制度には依存しない)。
 *
 * engine の listScheduledWorkDates は法定休日の判定に SettingsSpan[] を取るため、テナント設定の版から
 * 法定休日だけが意味を持つ span を組み立てる(workSystem 等は数え方に使われないので仮の値)。
 */
async function previewScheduledWorkDays(db: Database, tenantId: string, calendarRows: ScheduledHolidayCalendarVersion[]) {
  const today = todayLocalDate(TZ_OFFSET_MINUTES_JST);
  const [year, month] = today.split("-").map(Number) as [number, number];
  const startIndex = year * 12 + (month - 1);
  const lastIndex = startIndex + PREVIEW_MONTHS - 1;
  const fromDate = formatDate(year, month, 1);
  const lastYear = Math.floor(lastIndex / 12);
  const lastMonth = (lastIndex % 12) + 1;
  const toDate = dateFromEpochDay(epochDayFromDate(formatDate(lastYear, lastMonth, 1)) + daysInMonth(lastYear, lastMonth) - 1);

  const tenantVersions = await getSettingsTimeline(db, { tenantId, fromDate, toDate });
  if (tenantVersions.length === 0) return [];
  const settingsTimeline: SettingsSpan[] = tenantVersions.map((v) => ({
    from: v.effectiveFrom,
    settings: {
      tzOffsetMinutes: TZ_OFFSET_MINUTES_JST,
      dayBoundaryMinutes: v.dayBoundaryMinutes,
      weekStartWeekday: 0,
      legalHoliday: JSON.parse(v.legalHolidayRule) as LegalHolidayRule,
      workSystem: { kind: "flex", settlement: "monthly", core: null, standardDayMinutes: 480 },
      breakRule: JSON.parse(v.breakRule) as BreakRule,
    },
  }));
  const calendarTimeline = calendarRows.map((row) => ({ from: row.effectiveFrom, calendar: parseCalendarVersion(row) }));

  const preview: Array<{ month: string; scheduledWorkDays: number; nationalHolidayDataUnavailable: boolean }> = [];
  for (let index = startIndex; index <= lastIndex; index++) {
    const period = { year: Math.floor(index / 12), month: (index % 12) + 1 };
    const result = listScheduledWorkDates(calendarTimeline, settingsTimeline, period);
    preview.push({
      month: formatDate(period.year, period.month, 1).slice(0, 7),
      scheduledWorkDays: result.dates.length,
      nationalHolidayDataUnavailable: result.nationalHolidayDataUnavailable,
    });
  }
  return preview;
}

export function registerHolidayCalendarRoutes(app: Hono<AppEnv>, db: Database, _deps: SettingsRoutesDeps) {
  app.get("/holiday-calendar", async (c) => {
    requirePermission(c, ATTENDANCE_CALENDAR_PERMISSION, "tenant");
    const user = c.get("user");
    const today = todayLocalDate(TZ_OFFSET_MINUTES_JST);

    const history = await listScheduledHolidayCalendarVersions(db, user.tenantId);
    let effective: ScheduledHolidayCalendarVersion | null = null;
    for (const v of history) {
      if (v.effectiveFrom <= today && (effective === null || v.effectiveFrom > effective.effectiveFrom)) effective = v;
    }

    return c.json({
      effective: effective ? serializeCalendarVersion(effective) : null,
      history: history.map(serializeCalendarVersion),
      // 版が無いときに使われる既定(土日・祝日)。画面は effective が null ならこれを初期値に出す
      defaults: DEFAULT_SCHEDULED_HOLIDAY_CALENDAR,
      // 同梱している国民の祝日のデータの範囲(年)。範囲外の年は祝日を判定できない
      nationalHolidayDataRange: NATIONAL_HOLIDAY_DATA_RANGE,
      preview: await previewScheduledWorkDays(db, user.tenantId, history),
    });
  });

  app.post("/holiday-calendar", async (c) => {
    requirePermission(c, ATTENDANCE_CALENDAR_PERMISSION, "tenant");
    const user = c.get("user");

    const body = await parseJsonRecord(c);
    if (body === null) return c.json({ error: "invalid_body" }, 400);

    if (!isValidLocalDate(body.effectiveFrom)) return c.json({ error: "invalid_effective_from" }, 400);
    const effectiveFrom = body.effectiveFrom;

    const calendar = parseCalendar(body);
    if ("error" in calendar) return c.json({ error: calendar.error }, 400);

    // 過去日の版追加は禁止(当日以降のみ) — 過去の契約上の枠を変えてしまうため。
    const today = todayLocalDate(TZ_OFFSET_MINUTES_JST);
    if (effectiveFrom < today) return c.json({ error: "effective_from_in_past" }, 409);

    const history = await listScheduledHolidayCalendarVersions(db, user.tenantId);
    if (history.some((v) => v.effectiveFrom === effectiveFrom)) {
      return c.json({ error: "version_already_exists" }, 409);
    }

    const now = nowMinutes();
    const inserted = await insertScheduledHolidayCalendarVersion(db, {
      tenantId: user.tenantId,
      effectiveFrom,
      weekdays: JSON.stringify(calendar.weekdays),
      nationalHolidays: calendar.nationalHolidays,
      extraHolidays: JSON.stringify(calendar.extraHolidays),
      extraWorkdays: JSON.stringify(calendar.extraWorkdays),
      createdAt: now,
    });

    const latest = history.length > 0 ? (history[history.length - 1] as ScheduledHolidayCalendarVersion) : null;
    await insertAuditLog(db, {
      tenantId: user.tenantId,
      actorId: user.id,
      action: "scheduled_holiday_calendar_version.create",
      targetType: "scheduled_holiday_calendar_versions",
      targetId: inserted.id,
      detail: JSON.stringify({
        before: latest ? serializeCalendarVersion(latest) : null,
        after: serializeCalendarVersion(inserted),
      }),
      occurredAt: now,
    });

    return c.json({ version: serializeCalendarVersion(inserted) }, 201);
  });
}
