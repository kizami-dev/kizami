import { describe, expect, it } from "vitest";
import { createNotificationIfAbsent, insertPunchEvent, listNotifications, type Database } from "@kizami/db";
import { runOvertimeAlertScan } from "../src/overtime-alerts.js";
import { jstMinutes, setupTestDb } from "./support/setup.js";

/**
 * 36協定アラート(基本版)のテスト。
 *
 * setupTestDb() が作るテナントはフレックス月清算(標準1日480分)・日界0時固定なので、
 * 月枠(frameMinutes)は engine の計算式 floor(週40h(2400分) × 暦日数 / 7) に従う。
 * - 2026年4月(30日): floor(2400*30/7) = 10285分
 * - 2026年2月(28日, 平年): floor(2400*28/7) = 9600分
 *
 * 「時間外(totals.overtime)」はこの月枠を超えた実労働分なので、月の前半だけでは
 * (24時間365日休みなく働いたとしても)物理的に月枠を超え得ない月がほとんどである
 * (例: 2月は6日連続24時間労働でも 6*1440=8640 < 9600 で overtime は 0 のまま)。
 * 「経過7日未満は見込み通知を出さない」ガード(要件で明示された決定)は、この意味で
 * 通常の勤務データでは滅多に効かない防御的な仕様だが、境界条件として実装通り検証する。
 *
 * setupTestDb() の legalHolidayRule は「日曜(weekday=0)」固定。法定休日の労働は
 * workedMinutes に算入されない(engine の daily.ts)ため、insertDailyShifts は
 * 日曜をスキップして打刻を作る(そうしないと実働分数の計算が狂う)。
 */

/** 指定ローカル日付("YYYY-MM-DD" 相当の year/month/day)が日曜(JST)かどうか。 */
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
    if (isSundayJst(year, month, day)) continue; // 法定休日(日曜)は打刻しない(実働に算入されないため)
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

describe("runOvertimeAlertScan", () => {
  it("creates overtime_45h_reached when this month's overtime is already at or above 45h", async () => {
    const { db, tenantId, userId } = await setupTestDb();

    // 4/1-4/22(日曜4/5,4/12,4/19を除く19日)を 09:00-21:00(12時間)勤務:
    // 実働 19*720=13680分, 月枠 10285分 → 時間外 3395分(≒56.6h) ≥ 2700分(45h)
    await insertDailyShifts(db, { tenantId, userId, year: 2026, month: 4, fromDay: 1, toDay: 22, startHour: 9, endHour: 21 });

    const nowMinutes = jstMinutes(2026, 4, 25, 12, 0);
    const result = await runOvertimeAlertScan(db, { nowMinutes });

    expect(result.scannedUserCount).toBe(1);
    expect(result.created).toHaveLength(1);
    expect(result.created[0]?.notification.type).toBe("overtime_45h_reached");
    expect(result.created[0]?.notification.subjectDate).toBe("2026-04-01");

    const stored = await listNotifications(db, { tenantId, userId });
    expect(stored).toHaveLength(1);
    expect(stored[0]?.type).toBe("overtime_45h_reached");
  });

  it("creates overtime_45h_projected when under 45h but the mid-month pace projects over 45h", async () => {
    const { db, tenantId, userId } = await setupTestDb();

    // 4/1-4/14(日曜4/5,4/12を除く12日)を 04:00-21:00(17時間)勤務:
    // 実働 12*1020=12240分 → 時間外 1955分(<2700分、未達)
    await insertDailyShifts(db, { tenantId, userId, year: 2026, month: 4, fromDay: 1, toDay: 14, startHour: 4, endHour: 21 });

    // 「今日」= 4/15(経過15日、当月30日)
    // 見込み実働 = 12240 * (30/15) = 24480分 → 見込み時間外 = 24480 - 10285 = 14195分 > 2700分(45h)
    const nowMinutes = jstMinutes(2026, 4, 15, 12, 0);
    const result = await runOvertimeAlertScan(db, { nowMinutes });

    expect(result.created).toHaveLength(1);
    expect(result.created[0]?.notification.type).toBe("overtime_45h_projected");
    expect(result.created[0]?.notification.subjectDate).toBe("2026-04-01");

    const stored = await listNotifications(db, { tenantId, userId });
    expect(stored).toHaveLength(1);
    expect(stored[0]?.type).toBe("overtime_45h_projected");
  });

  it("projects from actual worked minutes, not from mid-month overtime (which is 0 under flex)", async () => {
    const { db, tenantId, userId } = await setupTestDb();

    // 4/1-4/15(日曜4/5,4/12を除く13日)を 09:00-19:00(10時間)勤務:
    // 実働 13*600=7800分。月枠 10285分 に届かないので **時間外は 0 分**。
    // 時間外を日割りで伸ばす計算だと見込みも 0 のままで通知が出ないが、
    // 実労働から伸ばせば 7800*(30/15)=15600分 → 見込み時間外 5315分(≒88h)で警告できる。
    await insertDailyShifts(db, { tenantId, userId, year: 2026, month: 4, fromDay: 1, toDay: 15, startHour: 9, endHour: 19 });

    const nowMinutes = jstMinutes(2026, 4, 15, 20, 0);
    const result = await runOvertimeAlertScan(db, { nowMinutes });

    expect(result.created).toHaveLength(1);
    expect(result.created[0]?.notification.type).toBe("overtime_45h_projected");
    // 本文には実績(0時間0分)と見込みの両方が出る
    expect(result.created[0]?.notification.body).toContain("見込み");
  });

  it("does not create a projected notification before day 7 of the month, even at maximum feasible pace", async () => {
    const { db, tenantId, userId } = await setupTestDb();

    // 2/1-2/5(2026年は平年)を 02:00-22:00(20時間)勤務させても実働 5*1200=6000分 < 月枠 9600分
    // → 時間外は 0 のまま。経過日数(6日)が7日未満のガードを境界的に確認する。
    await insertDailyShifts(db, { tenantId, userId, year: 2026, month: 2, fromDay: 1, toDay: 5, startHour: 2, endHour: 22 });

    const nowMinutes = jstMinutes(2026, 2, 6, 12, 0);
    const result = await runOvertimeAlertScan(db, { nowMinutes });

    expect(result.created).toHaveLength(0);
    expect(await listNotifications(db, { tenantId, userId })).toHaveLength(0);
  });

  it("creates no notification when overtime is low and the pace is not a concern", async () => {
    const { db, tenantId, userId } = await setupTestDb();

    // 4/1-4/19 を通常の 09:00-17:00(8時間)勤務: 実働 19*480=9120分 < 月枠 10285分 → 時間外 0
    await insertDailyShifts(db, { tenantId, userId, year: 2026, month: 4, fromDay: 1, toDay: 19, startHour: 9, endHour: 17 });

    const nowMinutes = jstMinutes(2026, 4, 20, 12, 0);
    const result = await runOvertimeAlertScan(db, { nowMinutes });

    expect(result.created).toHaveLength(0);
    expect(await listNotifications(db, { tenantId, userId })).toHaveLength(0);
  });

  it("is idempotent: scanning twice for the same month only creates one reached notification", async () => {
    const { db, tenantId, userId } = await setupTestDb();

    await insertDailyShifts(db, { tenantId, userId, year: 2026, month: 4, fromDay: 1, toDay: 22, startHour: 9, endHour: 21 });

    const nowMinutes = jstMinutes(2026, 4, 25, 12, 0);
    const first = await runOvertimeAlertScan(db, { nowMinutes });
    expect(first.created).toHaveLength(1);

    const second = await runOvertimeAlertScan(db, { nowMinutes: nowMinutes + 5 });
    expect(second.created).toHaveLength(0);

    expect(await listNotifications(db, { tenantId, userId })).toHaveLength(1);
  });

  it("does not create a projected notification when a reached notification already exists for the month", async () => {
    const { db, tenantId, userId } = await setupTestDb();

    // 見込み超過が起きる(はずの)時間外1955分/見込み3910分のシナリオ(test2と同条件)だが、
    // あらかじめ同じ月の reached 通知を作っておく(たとえば別スキャンで既に実績超過が
    // 記録された想定)。
    await createNotificationIfAbsent(db, {
      tenantId,
      userId,
      type: "overtime_45h_reached",
      subjectDate: "2026-04-01",
      title: "既に実績が45時間に達しています",
      body: "既存の reached 通知(テスト用のダミー)",
      createdAt: 0,
    });

    await insertDailyShifts(db, { tenantId, userId, year: 2026, month: 4, fromDay: 1, toDay: 14, startHour: 4, endHour: 21 });

    const nowMinutes = jstMinutes(2026, 4, 15, 12, 0);
    const result = await runOvertimeAlertScan(db, { nowMinutes });

    expect(result.created).toHaveLength(0);

    const stored = await listNotifications(db, { tenantId, userId });
    expect(stored).toHaveLength(1);
    expect(stored[0]?.type).toBe("overtime_45h_reached");
  });
});
