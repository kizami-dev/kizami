/**
 * シフト制(monthly_variable)ユーザーの有給の分数換算(v0.7 フェーズ4、Part A)。
 *
 * 以前は `standardDayMinutesForDate` が monthly_variable で例外を投げていたため、
 * GET /leave/balance がこの制度のユーザーで 500 になっていた。新しい規則:
 * 1. その日に有効な shift_day(dayType=work)があればそのシフトの所定
 * 2. 無ければ work_policy_versions.standard_day_minutes(=基準所定、有給換算用)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { insertLeaveGrant, insertShiftPlan, upsertShiftDaysForPlan, type Database } from "@kizami/db";
import { createApp } from "../src/app.js";
import {
  grantPermission,
  loginAndGetCookie,
  setupTestDb,
  setVariablePeriodStartDay,
  switchToMonthlyVariableWorkPolicy,
} from "./support/setup.js";

// JST 2026-04-15 12:00
const FIXED_NOW = new Date("2026-04-15T03:00:00.000Z");

/** 基準所定(switchToMonthlyVariableWorkPolicy が入れる work_policy_versions の値)。 */
const BASE_DAY_MINUTES = 480;

interface BalanceJson {
  standardDayMinutes: number;
  annual: { totalGrantedMinutes: number; usedMinutes: number; remainingMinutes: number };
}

/** 2026-04-20 に 10:00-20:00(休憩60分)= 540分 のシフトを1日だけ置く。 */
async function seedShiftDay(db: Database, params: { tenantId: string; userId: string; date: string }): Promise<void> {
  const plan = await insertShiftPlan(db, {
    tenantId: params.tenantId,
    userId: params.userId,
    periodStart: "2026-04-01",
    periodEnd: "2026-04-30",
    createdAt: 0,
  });
  await upsertShiftDaysForPlan(db, {
    tenantId: params.tenantId,
    userId: params.userId,
    planId: plan.id,
    days: [{ date: params.date, dayType: "work", startMinutes: 600, endMinutes: 1200, breakMinutes: 60, patternId: null }],
    createdBy: params.userId,
    createdAt: 0,
  });
}

describe("monthly_variable ユーザーの有給分数換算", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("GET /leave/balance が 500 にならず、基準所定を standardDayMinutes として返す", async () => {
    const { db, tenantId, email, password } = await setupTestDb();
    await switchToMonthlyVariableWorkPolicy(db, { tenantId });
    await setVariablePeriodStartDay(db, { tenantId, variablePeriodStartDay: 1 });

    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const res = await app.request("/leave/balance", { headers: { cookie } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as BalanceJson;
    expect(body.standardDayMinutes).toBe(BASE_DAY_MINUTES);
  });

  it("シフトのある日の全休は、そのシフトの所定(540分)で消化される", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await switchToMonthlyVariableWorkPolicy(db, { tenantId });
    await setVariablePeriodStartDay(db, { tenantId, variablePeriodStartDay: 1 });
    await seedShiftDay(db, { tenantId, userId, date: "2026-04-20" });
    await insertLeaveGrant(db, {
      tenantId,
      userId,
      leaveType: "annual",
      grantedOn: "2026-01-01",
      days: 10,
      expiresOn: "2028-01-01",
      source: "manual",
      createdAt: 0,
    });
    await grantPermission(db, { tenantId, userId, permission: "leave.request.approve", scope: "tenant" });

    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const createRes = await app.request("/leave/requests", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ leaveDate: "2026-04-20", unit: "full_day", reason: "私用" }),
    });
    expect(createRes.status).toBe(201);
    const requestId = ((await createRes.json()) as { request: { id: string } }).request.id;

    const approveRes = await app.request(`/leave/requests/${requestId}/approve`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({}),
    });
    expect(approveRes.status).toBe(200);

    const balance = (await (await app.request("/leave/balance", { headers: { cookie } })).json()) as BalanceJson;
    // 10日 × 基準所定480分 = 4800分の枠から、シフトの所定 540分 を消化する。
    expect(balance.annual.totalGrantedMinutes).toBe(10 * BASE_DAY_MINUTES);
    expect(balance.annual.usedMinutes).toBe(540);
  });

  it("シフトの無い日の全休は、基準所定(480分)で消化される", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await switchToMonthlyVariableWorkPolicy(db, { tenantId });
    await setVariablePeriodStartDay(db, { tenantId, variablePeriodStartDay: 1 });
    // 2026-04-20 にだけシフトがある。申請するのは 2026-04-21(シフト無し)。
    await seedShiftDay(db, { tenantId, userId, date: "2026-04-20" });
    await insertLeaveGrant(db, {
      tenantId,
      userId,
      leaveType: "annual",
      grantedOn: "2026-01-01",
      days: 10,
      expiresOn: "2028-01-01",
      source: "manual",
      createdAt: 0,
    });
    await grantPermission(db, { tenantId, userId, permission: "leave.request.approve", scope: "tenant" });

    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const createRes = await app.request("/leave/requests", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ leaveDate: "2026-04-21", unit: "full_day", reason: "私用" }),
    });
    expect(createRes.status).toBe(201);
    const requestId = ((await createRes.json()) as { request: { id: string } }).request.id;

    const approveRes = await app.request(`/leave/requests/${requestId}/approve`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({}),
    });
    expect(approveRes.status).toBe(200);

    const balance = (await (await app.request("/leave/balance", { headers: { cookie } })).json()) as BalanceJson;
    expect(balance.annual.usedMinutes).toBe(BASE_DAY_MINUTES);
  });

  it("GET /attendance/monthly が monthly_variable ユーザーの承認済み有給込みで 200 を返す", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await switchToMonthlyVariableWorkPolicy(db, { tenantId });
    await setVariablePeriodStartDay(db, { tenantId, variablePeriodStartDay: 1 });
    await seedShiftDay(db, { tenantId, userId, date: "2026-04-20" });
    await insertLeaveGrant(db, {
      tenantId,
      userId,
      leaveType: "annual",
      grantedOn: "2026-01-01",
      days: 10,
      expiresOn: "2028-01-01",
      source: "manual",
      createdAt: 0,
    });
    await grantPermission(db, { tenantId, userId, permission: "leave.request.approve", scope: "tenant" });

    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const createRes = await app.request("/leave/requests", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ leaveDate: "2026-04-20", unit: "full_day", reason: "私用" }),
    });
    const requestId = ((await createRes.json()) as { request: { id: string } }).request.id;
    await app.request(`/leave/requests/${requestId}/approve`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({}),
    });

    const res = await app.request("/attendance/monthly?month=2026-04", { headers: { cookie } });
    expect(res.status).toBe(200);
  });

  it("フレックス(既定)のユーザーは従来どおり work_policy_versions の標準労働時間を使う", async () => {
    const { db, tenantId, email, password } = await setupTestDb();
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const res = await app.request("/leave/balance", { headers: { cookie } });
    expect(res.status).toBe(200);
    expect(((await res.json()) as BalanceJson).standardDayMinutes).toBe(480);
  });
});
