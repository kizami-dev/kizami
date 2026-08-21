/**
 * GET /attendance/status, GET /attendance/monthly
 */

import { Hono } from "hono";
import { getEffectiveSettingsVersion, listValidPunches, type Database } from "@kizami/db";
import { calculate, type EngineInput, type PunchKind, type ValidPunch } from "@kizami/engine";
import type { AppEnv } from "../auth/middleware.js";
import { requireSelf } from "../authz.js";
import {
  dateFromEpochDay,
  daysInMonth,
  epochDayFromDate,
  formatDate,
  localMidnightUtcMinutes,
  nowMinutes,
  parseMonthParam,
} from "../lib/time.js";
import { buildSettingsTimeline, TZ_OFFSET_MINUTES_JST } from "../lib/settings.js";

const MINUTES_PER_DAY = 1440;

/**
 * 「当日」の勤怠日の窓([dayStart, dayEnd))を UTC エポック分で解決する。
 *
 * packages/engine の resolveAttendanceDate と同じ「最新版で仮日付→その日の実際の版で
 * 再解決」の2パス方式を、GET /attendance/status のためだけに最小限で再実装している
 * (engine の内部モジュールは公開 API に含まれず import できないため)。
 */
async function resolveTodayWindow(
  db: Database,
  tenantId: string,
  atMinutes: number,
): Promise<{ dayStart: number; dayEnd: number }> {
  const tz = TZ_OFFSET_MINUTES_JST;
  const localMinutes = atMinutes + tz;
  const roughEpochDay = Math.floor(localMinutes / MINUTES_PER_DAY);
  const minuteOfDay = localMinutes - roughEpochDay * MINUTES_PER_DAY;

  const roughDate = dateFromEpochDay(roughEpochDay);
  const roughVersion = await getEffectiveSettingsVersion(db, { tenantId, onDate: roughDate });
  if (!roughVersion) {
    throw new Error(`no tenant settings version effective on or before ${roughDate}`);
  }

  const attendanceDayIndex = minuteOfDay >= roughVersion.dayBoundaryMinutes ? roughEpochDay : roughEpochDay - 1;
  const attendanceDate = dateFromEpochDay(attendanceDayIndex);

  const version = (await getEffectiveSettingsVersion(db, { tenantId, onDate: attendanceDate })) ?? roughVersion;

  const dayStart = localMidnightUtcMinutes(attendanceDayIndex, tz) + version.dayBoundaryMinutes;
  const dayEnd = localMidnightUtcMinutes(attendanceDayIndex + 1, tz) + version.dayBoundaryMinutes;
  return { dayStart, dayEnd };
}

type AttendanceState = "out" | "working" | "onBreak";

interface StatusResult {
  state: AttendanceState;
  lastPunch: { kind: PunchKind; occurredAt: number } | null;
}

/**
 * 有効打刻列の末尾状態を素朴にトレースする(engine の deriveSegments と同じ遷移規則)。
 * 無効な文脈の打刻(勤務外の clock_out/break、勤務中の再 clock_in 等)は無視する。
 * 例外的に「休憩中の clock_out」は休憩を閉じて退勤する有効な遷移として扱う
 * (docs/design/v01-data-model.md「不正打刻列の解釈ルール」参照)。
 */
function deriveStatus(punches: Array<{ kind: string; occurredAt: number }>): StatusResult {
  let state: AttendanceState = "out";
  let lastPunch: StatusResult["lastPunch"] = null;

  for (const punch of punches) {
    const kind = punch.kind as PunchKind;
    if (state === "out") {
      if (kind === "clock_in") {
        state = "working";
        lastPunch = { kind, occurredAt: punch.occurredAt };
      }
    } else if (state === "working") {
      if (kind === "clock_out") {
        state = "out";
        lastPunch = { kind, occurredAt: punch.occurredAt };
      } else if (kind === "break_start") {
        state = "onBreak";
        lastPunch = { kind, occurredAt: punch.occurredAt };
      }
    } else {
      // onBreak
      if (kind === "break_end") {
        state = "working";
        lastPunch = { kind, occurredAt: punch.occurredAt };
      } else if (kind === "clock_out") {
        state = "out";
        lastPunch = { kind, occurredAt: punch.occurredAt };
      }
    }
  }

  return { state, lastPunch };
}

export function createAttendanceRoutes(db: Database) {
  const app = new Hono<AppEnv>();

  app.get("/status", async (c) => {
    const user = c.get("user");
    requireSelf(c, user.id);

    const { dayStart, dayEnd } = await resolveTodayWindow(db, user.tenantId, nowMinutes());
    const punches = await listValidPunches(db, {
      tenantId: user.tenantId,
      userId: user.id,
      fromMinutes: dayStart,
      toMinutes: dayEnd - 1,
    });

    return c.json(deriveStatus(punches));
  });

  app.get("/monthly", async (c) => {
    const user = c.get("user");
    requireSelf(c, user.id);

    const parsedMonth = parseMonthParam(c.req.query("month"));
    if (!parsedMonth) {
      return c.json({ error: "invalid_month" }, 400);
    }
    const { year, month } = parsedMonth;

    const monthStartEpochDay = epochDayFromDate(formatDate(year, month, 1));
    const monthEndEpochDay = monthStartEpochDay + daysInMonth(year, month) - 1;
    const monthStartDate = dateFromEpochDay(monthStartEpochDay);
    const monthEndDate = dateFromEpochDay(monthEndEpochDay);

    const tz = TZ_OFFSET_MINUTES_JST;
    // 月初日界の前後1日はみ出しを含めて有効打刻を取得する
    const fromMinutes = localMidnightUtcMinutes(monthStartEpochDay - 1, tz);
    const toMinutes = localMidnightUtcMinutes(monthEndEpochDay + 2, tz) - 1;

    const [punchRows, settingsTimeline] = await Promise.all([
      listValidPunches(db, { tenantId: user.tenantId, userId: user.id, fromMinutes, toMinutes }),
      buildSettingsTimeline(db, {
        tenantId: user.tenantId,
        userId: user.id,
        fromDate: monthStartDate,
        toDate: monthEndDate,
      }),
    ]);

    const punches: ValidPunch[] = punchRows.map((p) => ({ kind: p.kind as PunchKind, occurredAt: p.occurredAt }));

    const input: EngineInput = {
      punches,
      settingsTimeline,
      period: { year, month },
      paidLeaveDays: [],
    };

    return c.json(calculate(input));
  });

  return app;
}
