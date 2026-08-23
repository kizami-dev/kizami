import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import {
  insertPunchEvent,
  insertShiftPlan,
  listNotifications,
  upsertShiftDaysForPlan,
  userPolicyAssignments,
  users,
  uuidv7,
  workPolicies,
  type Database,
} from "@kizami/db";
import { runShiftVarianceAlertScan } from "../src/shift-variance-alerts.js";
import {
  grantPermission,
  jstMinutes,
  setupSecondUser,
  setupTestDb,
  setVariablePeriodStartDay,
  switchToMonthlyVariableWorkPolicy,
} from "./support/setup.js";

const SHIFT_MANAGE_PERMISSION = "shift.manage";

// JST 2026-04-15 12:00(reminders.test.ts と同じ固定時刻)。
const FIXED_NOW = new Date("2026-04-15T03:00:00.000Z");
const FIXED_NOW_MINUTES = Math.floor(FIXED_NOW.getTime() / 60_000);

async function seedMonthlyVariablePlan(db: Database, params: { tenantId: string; userId: string }) {
  const { tenantId, userId } = params;
  const plan = await insertShiftPlan(db, { tenantId, userId, periodStart: "2026-04-01", periodEnd: "2026-04-30", createdAt: 0 });
  await upsertShiftDaysForPlan(db, {
    tenantId,
    userId,
    planId: plan.id,
    days: [{ date: "2026-04-01", dayType: "work", startMinutes: 540, endMinutes: 1080, breakMinutes: 60, patternId: null }],
    createdBy: userId,
    createdAt: 0,
  });
  return plan;
}

/**
 * `setupSecondUser` は work_policy 割当を行わない(setup.ts のコメント参照)ため、
 * 月次集計を必要とするこのテストでは追加で割り当てる。
 */
async function assignExistingWorkPolicy(db: Database, params: { tenantId: string; userId: string }): Promise<void> {
  const rows = await db.select().from(workPolicies).where(eq(workPolicies.tenantId, params.tenantId)).limit(1);
  const workPolicyId = rows[0]?.id;
  if (!workPolicyId) throw new Error("assignExistingWorkPolicy: no work_policies row for tenant");
  await db.insert(userPolicyAssignments).values({
    id: uuidv7(),
    tenantId: params.tenantId,
    userId: params.userId,
    workPolicyId,
    effectiveFrom: "1970-01-01",
    createdAt: 0,
  });
}

describe("runShiftVarianceAlertScan", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("遅刻(shift_late_arrival)を検知し、承認者へ1件の通知を作る(本人には作らない)", async () => {
    const { db, tenantId, userId } = await setupTestDb();
    await switchToMonthlyVariableWorkPolicy(db, { tenantId });
    await setVariablePeriodStartDay(db, { tenantId, variablePeriodStartDay: 1 });
    await seedMonthlyVariablePlan(db, { tenantId, userId });

    const approver = await setupSecondUser(db, tenantId);
    await grantPermission(db, { tenantId, userId: approver.userId, permission: SHIFT_MANAGE_PERMISSION, scope: "tenant" });

    // シフトは9:00開始だが、実際の出勤は10:00(遅刻)。退勤は所定どおり18:00。
    const clockInAt = jstMinutes(2026, 4, 1, 10, 0);
    const clockOutAt = jstMinutes(2026, 4, 1, 18, 0);
    await insertPunchEvent(db, { tenantId, userId, kind: "clock_in", occurredAt: clockInAt, recordedAt: clockInAt, source: "web", actorId: userId });
    await insertPunchEvent(db, { tenantId, userId, kind: "clock_out", occurredAt: clockOutAt, recordedAt: clockOutAt, source: "web", actorId: userId });

    const result = await runShiftVarianceAlertScan(db, { nowMinutes: FIXED_NOW_MINUTES });

    expect(result.created).toHaveLength(1);
    expect(result.created[0]?.notification.type).toBe("shift_variance_alert");
    expect(result.created[0]?.notification.subjectDate).toBe("2026-04-01");
    expect(result.created[0]?.notification.userId).toBe(approver.userId);
    expect(result.created[0]?.notification.body).toContain("遅刻");

    const approverNotifications = await listNotifications(db, { tenantId, userId: approver.userId });
    expect(approverNotifications).toHaveLength(1);

    // 本人(乖離の当事者)には通知しない(決定事項4: 宛先は承認権限者)。
    const subjectNotifications = await listNotifications(db, { tenantId, userId });
    expect(subjectNotifications).toHaveLength(0);
  });

  it("シフト未登録なのに勤務がある(missing_shift)場合も検知する", async () => {
    const { db, tenantId, userId } = await setupTestDb();
    await switchToMonthlyVariableWorkPolicy(db, { tenantId });
    await setVariablePeriodStartDay(db, { tenantId, variablePeriodStartDay: 1 });
    // シフト計画は一切作らない。

    const approver = await setupSecondUser(db, tenantId);
    await grantPermission(db, { tenantId, userId: approver.userId, permission: SHIFT_MANAGE_PERMISSION, scope: "tenant" });

    const clockInAt = jstMinutes(2026, 4, 1, 9, 0);
    const clockOutAt = jstMinutes(2026, 4, 1, 18, 0);
    await insertPunchEvent(db, { tenantId, userId, kind: "clock_in", occurredAt: clockInAt, recordedAt: clockInAt, source: "web", actorId: userId });
    await insertPunchEvent(db, { tenantId, userId, kind: "clock_out", occurredAt: clockOutAt, recordedAt: clockOutAt, source: "web", actorId: userId });

    const result = await runShiftVarianceAlertScan(db, { nowMinutes: FIXED_NOW_MINUTES });
    expect(result.created).toHaveLength(1);
    expect(result.created[0]?.notification.body).toContain("シフト未登録");
  });

  it("冪等: 同じ日の乖離に対して2回目のスキャンは通知を作らない", async () => {
    const { db, tenantId, userId } = await setupTestDb();
    await switchToMonthlyVariableWorkPolicy(db, { tenantId });
    await setVariablePeriodStartDay(db, { tenantId, variablePeriodStartDay: 1 });
    await seedMonthlyVariablePlan(db, { tenantId, userId });

    const approver = await setupSecondUser(db, tenantId);
    await grantPermission(db, { tenantId, userId: approver.userId, permission: SHIFT_MANAGE_PERMISSION, scope: "tenant" });

    const clockInAt = jstMinutes(2026, 4, 1, 10, 0);
    const clockOutAt = jstMinutes(2026, 4, 1, 18, 0);
    await insertPunchEvent(db, { tenantId, userId, kind: "clock_in", occurredAt: clockInAt, recordedAt: clockInAt, source: "web", actorId: userId });
    await insertPunchEvent(db, { tenantId, userId, kind: "clock_out", occurredAt: clockOutAt, recordedAt: clockOutAt, source: "web", actorId: userId });

    const first = await runShiftVarianceAlertScan(db, { nowMinutes: FIXED_NOW_MINUTES });
    expect(first.created).toHaveLength(1);

    const second = await runShiftVarianceAlertScan(db, { nowMinutes: FIXED_NOW_MINUTES + 5 });
    expect(second.created).toHaveLength(0);

    expect(await listNotifications(db, { tenantId, userId: approver.userId })).toHaveLength(1);
  });

  it("同じ承認者・同じ日の複数メンバーの乖離は1件にまとまる", async () => {
    const { db, tenantId, userId } = await setupTestDb();
    await switchToMonthlyVariableWorkPolicy(db, { tenantId });
    await setVariablePeriodStartDay(db, { tenantId, variablePeriodStartDay: 1 });
    await seedMonthlyVariablePlan(db, { tenantId, userId });

    const second = await setupSecondUser(db, tenantId);
    await assignExistingWorkPolicy(db, { tenantId, userId: second.userId });
    await seedMonthlyVariablePlan(db, { tenantId, userId: second.userId });

    const approver = { userId: uuidv7(), email: "approver@example.com" };
    await db.insert(users).values({
      id: approver.userId,
      tenantId,
      email: approver.email,
      name: "Approver",
      isActive: true,
      createdAt: 0,
    });
    await grantPermission(db, { tenantId, userId: approver.userId, permission: SHIFT_MANAGE_PERMISSION, scope: "tenant" });

    for (const uid of [userId, second.userId]) {
      const clockInAt = jstMinutes(2026, 4, 1, 10, 0);
      const clockOutAt = jstMinutes(2026, 4, 1, 18, 0);
      await insertPunchEvent(db, { tenantId, userId: uid, kind: "clock_in", occurredAt: clockInAt, recordedAt: clockInAt, source: "web", actorId: uid });
      await insertPunchEvent(db, { tenantId, userId: uid, kind: "clock_out", occurredAt: clockOutAt, recordedAt: clockOutAt, source: "web", actorId: uid });
    }

    const result = await runShiftVarianceAlertScan(db, { nowMinutes: FIXED_NOW_MINUTES });
    expect(result.created).toHaveLength(1);
    expect(result.created[0]?.notification.body).toContain("Test User");
    expect(result.created[0]?.notification.body).toContain("Second User");
  });

  it("monthly_variable でないテナントでは何も検知しない", async () => {
    const { db, tenantId, userId } = await setupTestDb();
    const approver = await setupSecondUser(db, tenantId);
    await grantPermission(db, { tenantId, userId: approver.userId, permission: SHIFT_MANAGE_PERMISSION, scope: "tenant" });

    const clockInAt = jstMinutes(2026, 4, 1, 9, 0);
    const clockOutAt = jstMinutes(2026, 4, 1, 18, 0);
    await insertPunchEvent(db, { tenantId, userId, kind: "clock_in", occurredAt: clockInAt, recordedAt: clockInAt, source: "web", actorId: userId });
    await insertPunchEvent(db, { tenantId, userId, kind: "clock_out", occurredAt: clockOutAt, recordedAt: clockOutAt, source: "web", actorId: userId });

    const result = await runShiftVarianceAlertScan(db, { nowMinutes: FIXED_NOW_MINUTES });
    expect(result.created).toHaveLength(0);
  });
});
