import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { insertPunchEvent, listNotifications, tenants, type Database } from "@kizami/db";
import { runOvertimeAlertScan } from "../src/overtime-alerts.js";
import { jstMinutes, setupTestDb } from "./support/setup.js";

/**
 * 36協定アラート完全版(v0.3: 年360h・特別条項)のテスト。
 * 月45h(v0.2)の既存テストは test/overtime-alerts.test.ts に残したまま、ここでは
 * 年度集計・特別条項の4種・特別条項無効時の文面・年度境界(3月/4月)だけを対象にする。
 *
 * setupTestDb() が作るテナントは中小企業(is_small_or_medium_enterprise=true)・特例措置対象外・
 * 特別条項未締結(special_clause_enabled=false)が既定値。特別条項系のテストは
 * setSpecialClauseEnabled() で明示的に有効化する。
 */

function daysInCivilMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function isSundayJst(year: number, month: number, day: number): boolean {
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay() === 0;
}

async function insertDailyShifts(
  db: Database,
  params: {
    tenantId: string;
    userId: string;
    year: number;
    month: number;
    fromDay: number;
    toDay: number;
    startHour: number;
    endHour: number;
  },
): Promise<void> {
  const { tenantId, userId, year, month, fromDay, toDay, startHour, endHour } = params;
  for (let day = fromDay; day <= toDay; day++) {
    if (isSundayJst(year, month, day)) continue; // 法定休日(日曜)は打刻しない
    const clockInAt = jstMinutes(year, month, day, startHour, 0);
    const clockOutAt = jstMinutes(year, month, day, endHour, 0);
    await insertPunchEvent(db, {
      tenantId,
      userId,
      kind: "clock_in",
      occurredAt: clockInAt,
      recordedAt: clockInAt,
      source: "web",
      actorId: userId,
    });
    await insertPunchEvent(db, {
      tenantId,
      userId,
      kind: "clock_out",
      occurredAt: clockOutAt,
      recordedAt: clockOutAt,
      source: "web",
      actorId: userId,
    });
  }
}

/** その月まるまるを非日曜だけ startHour〜endHour で埋める(daysInCivilMonth を使って月末まで)。 */
async function fillWholeMonth(
  db: Database,
  params: { tenantId: string; userId: string; year: number; month: number; startHour: number; endHour: number },
): Promise<void> {
  const { tenantId, userId, year, month, startHour, endHour } = params;
  await insertDailyShifts(db, { tenantId, userId, year, month, fromDay: 1, toDay: daysInCivilMonth(year, month), startHour, endHour });
}

async function setSpecialClauseEnabled(db: Database, tenantId: string, enabled: boolean): Promise<void> {
  await db.update(tenants).set({ specialClauseEnabled: enabled }).where(eq(tenants.id, tenantId));
}

describe("runOvertimeAlertScan — v0.3 annual (360h)", () => {
  it("creates overtime_annual_limit_reached when the fiscal year's overtime already exceeds 360h", async () => {
    const { db, tenantId, userId } = await setupTestDb();

    // 2026-04を極端な23時間シフト(週休1日相当)で埋める: 26平日 * 1380分 = 35880分
    // frame(2026-04, 30日) = 10285分 → overtime = 25595分(> 21600分=360h)
    await fillWholeMonth(db, { tenantId, userId, year: 2026, month: 4, startHour: 0, endHour: 23 });

    const nowMinutes = jstMinutes(2026, 4, 30, 23, 50);
    const result = await runOvertimeAlertScan(db, { nowMinutes });

    const annual = result.created.find((c) => c.notification.type === "overtime_annual_limit_reached");
    expect(annual).toBeDefined();
    expect(annual?.notification.subjectDate).toBe("2026-04-01");

    const stored = await listNotifications(db, { tenantId, userId });
    expect(stored.some((n) => n.type === "overtime_annual_limit_reached" && n.subjectDate === "2026-04-01")).toBe(true);
  });

  it("creates overtime_annual_limit_projected when year-to-date + this month's pace projects over 360h, but not yet reached", async () => {
    const { db, tenantId, userId } = await setupTestDb();

    // 2026-04: 18平日 * 1380分(00:00-23:00) = 24840分, frame=10285 → overtime=14555分(確定月)
    await insertDailyShifts(db, { tenantId, userId, year: 2026, month: 4, fromDay: 1, toDay: 21, startHour: 0, endHour: 23 });
    // 2026-05は打刻なし(overtime=0、確定月)
    // 2026-06: 12平日 * 1020分(04:00-21:00) = 12240分, frame=10285 → overtime(実績)=1955分(45h未達、当月)
    await insertDailyShifts(db, { tenantId, userId, year: 2026, month: 6, fromDay: 1, toDay: 14, startHour: 4, endHour: 21 });

    // yearToDate(実績) = 14555(4月, 確定) + 0(5月, 確定) + 1955(6月, 実績) = 16510 < 21600(未到達)
    // 見込み: 6月の実労働12240分を6/15時点(経過15日)で月末までペース延伸
    //   → projectedActual = 12240*(30/15) = 24480 → projectedOvertime = 24480-10285 = 14195分
    // 見込み年間 = 14555(4月, 確定) + 0(5月, 確定) + 14195(6月, 見込み) = 28750 > 21600(超過)
    const nowMinutes = jstMinutes(2026, 6, 15, 12, 0);
    const result = await runOvertimeAlertScan(db, { nowMinutes });

    const annualProjected = result.created.find((c) => c.notification.type === "overtime_annual_limit_projected");
    expect(annualProjected).toBeDefined();
    expect(annualProjected?.notification.subjectDate).toBe("2026-04-01");

    // 実績はまだ到達していないので reached は作られない
    expect(result.created.some((c) => c.notification.type === "overtime_annual_limit_reached")).toBe(false);
  });

  it("fiscal year start for a January-March scan month is April of the *previous* calendar year", async () => {
    const { db, tenantId, userId } = await setupTestDb();

    // 2027-02(平年)を極端な23時間シフトで埋める: frame(2027-02,28日)=floor(2400*28/7)=9600分
    // 24平日(2027-02は4日曜) * 1380分 = 33120分 → overtime = 23520分(> 21600分)
    await fillWholeMonth(db, { tenantId, userId, year: 2027, month: 2, startHour: 0, endHour: 23 });

    const nowMinutes = jstMinutes(2027, 2, 27, 12, 0);
    const result = await runOvertimeAlertScan(db, { nowMinutes });

    const annual = result.created.find((c) => c.notification.type === "overtime_annual_limit_reached");
    expect(annual).toBeDefined();
    // 2027年2月の年度(4月始まり)は2026年4月始まり
    expect(annual?.notification.subjectDate).toBe("2026-04-01");
  });

  it("special-clause note is appended to the monthly-45h body when special_clause_enabled is false (default)", async () => {
    const { db, tenantId, userId } = await setupTestDb();

    await insertDailyShifts(db, { tenantId, userId, year: 2026, month: 4, fromDay: 1, toDay: 22, startHour: 9, endHour: 21 });
    const nowMinutes = jstMinutes(2026, 4, 25, 12, 0);
    const result = await runOvertimeAlertScan(db, { nowMinutes });

    const reached = result.created.find((c) => c.notification.type === "overtime_45h_reached");
    expect(reached).toBeDefined();
    expect(reached?.notification.body).toContain("特別条項");
  });

  it("special-clause note is NOT appended to the monthly-45h body when special_clause_enabled is true", async () => {
    const { db, tenantId, userId } = await setupTestDb();
    await setSpecialClauseEnabled(db, tenantId, true);

    await insertDailyShifts(db, { tenantId, userId, year: 2026, month: 4, fromDay: 1, toDay: 22, startHour: 9, endHour: 21 });
    const nowMinutes = jstMinutes(2026, 4, 25, 12, 0);
    const result = await runOvertimeAlertScan(db, { nowMinutes });

    const reached = result.created.find((c) => c.notification.type === "overtime_45h_reached");
    expect(reached).toBeDefined();
    expect(reached?.notification.body).not.toContain("特別条項");
  });
});

describe("runOvertimeAlertScan — v0.3 special clause thresholds (special_clause_enabled=true only)", () => {
  it("does not evaluate special-clause thresholds when special_clause_enabled is false (default)", async () => {
    const { db, tenantId, userId } = await setupTestDb();

    // 100h上限を優に超える極端な月(特別条項が有効なら overtime_special_monthly_cap が出るはずの状況)
    await fillWholeMonth(db, { tenantId, userId, year: 2026, month: 4, startHour: 0, endHour: 23 });
    const nowMinutes = jstMinutes(2026, 4, 30, 23, 50);
    const result = await runOvertimeAlertScan(db, { nowMinutes });

    expect(result.created.some((c) => c.notification.type === "overtime_special_monthly_cap")).toBe(false);
    expect(result.created.some((c) => c.notification.type === "overtime_special_average")).toBe(false);
    expect(result.created.some((c) => c.notification.type === "overtime_special_annual")).toBe(false);
    expect(result.created.some((c) => c.notification.type === "overtime_special_month_count")).toBe(false);
  });

  it("creates overtime_special_monthly_cap when a single month's overtime + holiday work reaches 100h", async () => {
    const { db, tenantId, userId } = await setupTestDb();
    await setSpecialClauseEnabled(db, tenantId, true);

    // 2026-04(30日, frame=10285)を 06:00-21:00(15h/900分)で1〜18日埋める(日曜4/5,4/12を除く16平日)
    // worked = 16*900 = 14400 → overtime = 14400-10285 = 4115...
    // 100h(6000分)に届かないため、さらに濃い目のシフトにする: 00:00-23:00(23h)で1〜18日
    await insertDailyShifts(db, { tenantId, userId, year: 2026, month: 4, fromDay: 1, toDay: 18, startHour: 0, endHour: 23 });
    // 16平日 * 1380分 = 22080分 → overtime = 22080-10285 = 11795分(>= 6000分=100h)

    const nowMinutes = jstMinutes(2026, 4, 20, 12, 0);
    const result = await runOvertimeAlertScan(db, { nowMinutes });

    const cap = result.created.find((c) => c.notification.type === "overtime_special_monthly_cap");
    expect(cap).toBeDefined();
    expect(cap?.notification.subjectDate).toBe("2026-04-01");

    const stored = await listNotifications(db, { tenantId, userId });
    expect(stored.some((n) => n.type === "overtime_special_monthly_cap")).toBe(true);
  });

  it("creates overtime_special_average when the 2-month average of overtime+holiday exceeds 80h (each month individually under 100h)", async () => {
    const { db, tenantId, userId } = await setupTestDb();
    await setSpecialClauseEnabled(db, tenantId, true);

    // 2026-04: 06:00-21:00(15h)で1〜20日(日曜4/5,4/12,4/19を除く17平日) → worked=17*900=15300
    //   frame(4月,30日)=10285 → overtime=5015分(<6000=100h)
    await insertDailyShifts(db, { tenantId, userId, year: 2026, month: 4, fromDay: 1, toDay: 20, startHour: 6, endHour: 21 });
    // 2026-05: 06:00-21:00(15h)で1〜21日(日曜5/3,5/10,5/17を除く18平日) → worked=18*900=16200
    //   frame(5月,31日)=10628 → overtime=5572分(<6000=100h)
    await insertDailyShifts(db, { tenantId, userId, year: 2026, month: 5, fromDay: 1, toDay: 21, startHour: 6, endHour: 21 });

    // 2ヶ月平均 = (5015+5572)/2 = 5293.5分(> 4800分=80h)
    const nowMinutes = jstMinutes(2026, 5, 25, 12, 0);
    const result = await runOvertimeAlertScan(db, { nowMinutes });

    const avg = result.created.find((c) => c.notification.type === "overtime_special_average");
    expect(avg).toBeDefined();
    expect(avg?.notification.subjectDate).toBe("2026-05-01");
    // 単月では100h上限に届いていないことの確認(平均判定が単月上限とは独立に効くことの確認)
    expect(result.created.some((c) => c.notification.type === "overtime_special_monthly_cap")).toBe(false);
  });

  it("creates overtime_special_annual when the fiscal year's overtime exceeds 720h", async () => {
    const { db, tenantId, userId } = await setupTestDb();
    await setSpecialClauseEnabled(db, tenantId, true);

    // 2026-04・2026-05をどちらも極端な23時間シフトで埋める
    await fillWholeMonth(db, { tenantId, userId, year: 2026, month: 4, startHour: 0, endHour: 23 });
    await fillWholeMonth(db, { tenantId, userId, year: 2026, month: 5, startHour: 0, endHour: 23 });
    // 4月overtime ≈ 25595分・5月overtime ≈ 25252分(概算)、合計 ≈ 50847分(> 43200分=720h)

    const nowMinutes = jstMinutes(2026, 5, 31, 23, 50);
    const result = await runOvertimeAlertScan(db, { nowMinutes });

    const special = result.created.find((c) => c.notification.type === "overtime_special_annual");
    expect(special).toBeDefined();
    expect(special?.notification.subjectDate).toBe("2026-04-01");
  });

  it("creates overtime_special_month_count when more than 6 months in the fiscal year exceed 45h", async () => {
    const { db, tenantId, userId } = await setupTestDb();
    await setSpecialClauseEnabled(db, tenantId, true);

    // 2026-04〜2026-10(7ヶ月)を 09:00-21:00(12h/720分)で毎月まるまる埋める。
    // 各月の平日数は約22〜27日あり、720分/日なら frame(約1万分)を大きく上回るため、
    // どの月も overtime >= 2700分(45h)になる(月45h超が7ヶ月連続 → 年6回の上限を超える)。
    for (const month of [4, 5, 6, 7, 8, 9, 10]) {
      await fillWholeMonth(db, { tenantId, userId, year: 2026, month, startHour: 9, endHour: 21 });
    }

    const nowMinutes = jstMinutes(2026, 10, 31, 23, 50);
    const result = await runOvertimeAlertScan(db, { nowMinutes });

    const monthCount = result.created.find((c) => c.notification.type === "overtime_special_month_count");
    expect(monthCount).toBeDefined();
    expect(monthCount?.notification.subjectDate).toBe("2026-04-01");
  });
});
