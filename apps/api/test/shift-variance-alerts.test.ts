import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import {
  insertPunchEvent,
  insertShiftPlan,
  listNotifications,
  upsertShiftDaysForPlan,
  upsertUserNotificationSettings,
  userPolicyAssignments,
  users,
  uuidv7,
  workPolicies,
  type Database,
} from "@kizami/db";
import { buildPersonalChannels } from "../src/lib/notification-channels.js";
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
const PERSONAL_WEBHOOK_URL = "https://personal.example/webhook";

/** 個人 Webhook への配信先 URL を記録するだけの fetch(実際の送信はしない)。 */
function recordingFetch(hits: string[]): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    hits.push(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
    return new Response("ok", { status: 200 });
  }) as typeof fetch;
}

/**
 * 個人の通知受け取り設定を1行入れる。`shift_variance` カテゴリ以外は既定(OFF)のまま。
 * 列を全部書くのは upsert が部分更新ではないため(packages/db の契約)。
 */
async function setShiftVariancePrefs(
  db: Database,
  params: { tenantId: string; userId: string; webhook: boolean; webhookUrl: string | null },
): Promise<void> {
  await upsertUserNotificationSettings(db, {
    tenantId: params.tenantId,
    userId: params.userId,
    missingClockOutEmail: false,
    missingClockOutWebhook: false,
    overtimeAlertEmail: false,
    overtimeAlertWebhook: false,
    leaveAlertEmail: false,
    leaveAlertWebhook: false,
    correctionAlertEmail: false,
    correctionAlertWebhook: false,
    approvalRequestEmail: false,
    approvalRequestWebhook: false,
    shiftVarianceEmail: false,
    shiftVarianceWebhook: params.webhook,
    emailAddress: null,
    webhookUrl: params.webhookUrl,
    updatedAt: 0,
  });
}

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

  it("遅刻(shift_late_arrival)を検知し、承認者と本人へそれぞれ1件ずつ通知を作る", async () => {
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

    // 本人(乖離の当事者)にも、自分の乖離だけを列挙した通知が届く(2026-08-24 追加)。
    expect(result.createdSelf).toHaveLength(1);
    expect(result.createdSelf[0]?.notification.type).toBe("shift_variance_self");
    expect(result.createdSelf[0]?.notification.userId).toBe(userId);
    expect(result.createdSelf[0]?.notification.subjectDate).toBe("2026-04-01");
    expect(result.createdSelf[0]?.notification.body).toContain("遅刻");
    // 本文には他人の名前が出ない(本人宛は自分の乖離だけ)。
    expect(result.createdSelf[0]?.notification.body).not.toContain("Test User");
    // 外部チャネルは resolveChannels 未指定なので使われない(アプリ内のみ)。
    expect(result.createdSelf[0]?.dispatchResults).toEqual([]);

    const subjectNotifications = await listNotifications(db, { tenantId, userId });
    expect(subjectNotifications).toHaveLength(1);
    expect(subjectNotifications[0]?.type).toBe("shift_variance_self");
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
    expect(result.createdSelf).toHaveLength(0);
  });

  it("乖離が無ければ(シフトどおりの勤務)本人通知も管理者通知も作らない", async () => {
    const { db, tenantId, userId } = await setupTestDb();
    await switchToMonthlyVariableWorkPolicy(db, { tenantId });
    await setVariablePeriodStartDay(db, { tenantId, variablePeriodStartDay: 1 });
    await seedMonthlyVariablePlan(db, { tenantId, userId });

    const approver = await setupSecondUser(db, tenantId);
    await grantPermission(db, { tenantId, userId: approver.userId, permission: SHIFT_MANAGE_PERMISSION, scope: "tenant" });

    // シフトどおり(9:00-18:00)に出退勤する。
    const clockInAt = jstMinutes(2026, 4, 1, 9, 0);
    const clockOutAt = jstMinutes(2026, 4, 1, 18, 0);
    await insertPunchEvent(db, { tenantId, userId, kind: "clock_in", occurredAt: clockInAt, recordedAt: clockInAt, source: "web", actorId: userId });
    await insertPunchEvent(db, { tenantId, userId, kind: "clock_out", occurredAt: clockOutAt, recordedAt: clockOutAt, source: "web", actorId: userId });

    const result = await runShiftVarianceAlertScan(db, { nowMinutes: FIXED_NOW_MINUTES });
    expect(result.created).toHaveLength(0);
    expect(result.createdSelf).toHaveLength(0);
    expect(await listNotifications(db, { tenantId, userId })).toHaveLength(0);
  });

  it("本人が shift_variance の個人 Webhook を ON にすると、その Webhook へ配信される", async () => {
    const { db, tenantId, userId } = await setupTestDb();
    await switchToMonthlyVariableWorkPolicy(db, { tenantId });
    await setVariablePeriodStartDay(db, { tenantId, variablePeriodStartDay: 1 });
    await seedMonthlyVariablePlan(db, { tenantId, userId });
    await setShiftVariancePrefs(db, { tenantId, userId, webhook: true, webhookUrl: PERSONAL_WEBHOOK_URL });

    const clockInAt = jstMinutes(2026, 4, 1, 10, 0);
    const clockOutAt = jstMinutes(2026, 4, 1, 18, 0);
    await insertPunchEvent(db, { tenantId, userId, kind: "clock_in", occurredAt: clockInAt, recordedAt: clockInAt, source: "web", actorId: userId });
    await insertPunchEvent(db, { tenantId, userId, kind: "clock_out", occurredAt: clockOutAt, recordedAt: clockOutAt, source: "web", actorId: userId });

    const hits: string[] = [];
    const result = await runShiftVarianceAlertScan(db, {
      nowMinutes: FIXED_NOW_MINUTES,
      resolveChannels: (t, u, notificationType) =>
        buildPersonalChannels(db, { tenantId: t, userId: u, notificationType }, { fetchImpl: recordingFetch(hits) }),
    });

    expect(result.createdSelf).toHaveLength(1);
    expect(hits).toEqual([PERSONAL_WEBHOOK_URL]);
  });

  it("shift_variance の個人 Webhook が既定(OFF)なら外部へは配信しない(アプリ内通知だけ作る)", async () => {
    const { db, tenantId, userId } = await setupTestDb();
    await switchToMonthlyVariableWorkPolicy(db, { tenantId });
    await setVariablePeriodStartDay(db, { tenantId, variablePeriodStartDay: 1 });
    await seedMonthlyVariablePlan(db, { tenantId, userId });
    // Webhook URL は設定するが、shift_variance カテゴリの webhook は既定(OFF)のまま。
    await setShiftVariancePrefs(db, { tenantId, userId, webhook: false, webhookUrl: PERSONAL_WEBHOOK_URL });

    const clockInAt = jstMinutes(2026, 4, 1, 10, 0);
    const clockOutAt = jstMinutes(2026, 4, 1, 18, 0);
    await insertPunchEvent(db, { tenantId, userId, kind: "clock_in", occurredAt: clockInAt, recordedAt: clockInAt, source: "web", actorId: userId });
    await insertPunchEvent(db, { tenantId, userId, kind: "clock_out", occurredAt: clockOutAt, recordedAt: clockOutAt, source: "web", actorId: userId });

    const hits: string[] = [];
    const result = await runShiftVarianceAlertScan(db, {
      nowMinutes: FIXED_NOW_MINUTES,
      resolveChannels: (t, u, notificationType) =>
        buildPersonalChannels(db, { tenantId: t, userId: u, notificationType }, { fetchImpl: recordingFetch(hits) }),
    });

    expect(result.createdSelf).toHaveLength(1);
    expect(hits).toEqual([]);
    expect(await listNotifications(db, { tenantId, userId })).toHaveLength(1);
  });

  it("本人向け通知も冪等(2回目のスキャンでは作られない)", async () => {
    const { db, tenantId, userId } = await setupTestDb();
    await switchToMonthlyVariableWorkPolicy(db, { tenantId });
    await setVariablePeriodStartDay(db, { tenantId, variablePeriodStartDay: 1 });
    await seedMonthlyVariablePlan(db, { tenantId, userId });

    const clockInAt = jstMinutes(2026, 4, 1, 10, 0);
    const clockOutAt = jstMinutes(2026, 4, 1, 18, 0);
    await insertPunchEvent(db, { tenantId, userId, kind: "clock_in", occurredAt: clockInAt, recordedAt: clockInAt, source: "web", actorId: userId });
    await insertPunchEvent(db, { tenantId, userId, kind: "clock_out", occurredAt: clockOutAt, recordedAt: clockOutAt, source: "web", actorId: userId });

    expect((await runShiftVarianceAlertScan(db, { nowMinutes: FIXED_NOW_MINUTES })).createdSelf).toHaveLength(1);
    expect((await runShiftVarianceAlertScan(db, { nowMinutes: FIXED_NOW_MINUTES + 5 })).createdSelf).toHaveLength(0);
    expect(await listNotifications(db, { tenantId, userId })).toHaveLength(1);
  });

  it("自分自身の承認者(shift.manage 保持者)は管理者ダイジェストと本人通知の両方を受け取る", async () => {
    const { db, tenantId, userId } = await setupTestDb();
    await switchToMonthlyVariableWorkPolicy(db, { tenantId });
    await setVariablePeriodStartDay(db, { tenantId, variablePeriodStartDay: 1 });
    await seedMonthlyVariablePlan(db, { tenantId, userId });
    // 本人がシフト管理権限を持つ(= 自分自身の承認者)。resolveApproversForUser は本人を除外
    // しないが、shift-variance-alerts 側で「本人以外」に絞るため管理者ダイジェストは
    // 本人には届かない — 一方で本人通知は届く。
    await grantPermission(db, { tenantId, userId, permission: SHIFT_MANAGE_PERMISSION, scope: "tenant" });

    const second = await setupSecondUser(db, tenantId);
    await assignExistingWorkPolicy(db, { tenantId, userId: second.userId });
    await seedMonthlyVariablePlan(db, { tenantId, userId: second.userId });

    for (const uid of [userId, second.userId]) {
      const clockInAt = jstMinutes(2026, 4, 1, 10, 0);
      const clockOutAt = jstMinutes(2026, 4, 1, 18, 0);
      await insertPunchEvent(db, { tenantId, userId: uid, kind: "clock_in", occurredAt: clockInAt, recordedAt: clockInAt, source: "web", actorId: uid });
      await insertPunchEvent(db, { tenantId, userId: uid, kind: "clock_out", occurredAt: clockOutAt, recordedAt: clockOutAt, source: "web", actorId: uid });
    }

    const result = await runShiftVarianceAlertScan(db, { nowMinutes: FIXED_NOW_MINUTES });

    // 管理者ダイジェストは「他人(second)の乖離」として1件、本人通知は2人ぶん。
    expect(result.created).toHaveLength(1);
    expect(result.created[0]?.notification.userId).toBe(userId);
    expect(result.createdSelf).toHaveLength(2);

    // 管理者でもある本人は、同じ日に種別の違う2件を受け取る(意図的に重複排除しない)。
    const ownNotifications = await listNotifications(db, { tenantId, userId });
    expect(ownNotifications.map((n) => n.type).sort()).toEqual(["shift_variance_alert", "shift_variance_self"]);
  });
});
