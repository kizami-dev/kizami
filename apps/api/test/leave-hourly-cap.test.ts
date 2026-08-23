/**
 * 時間単位年休の上限(2026-08-22 訂正版): 1時間切り上げ・年度単位・繰越込み。
 * 根拠: 労働基準法39条4項、平21.5.29基発0529001号。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { insertLeaveGrant, type Database } from "@kizami/db";
import { createApp } from "../src/app.js";
import { grantPermission, loginAndGetCookie, setupTestDb } from "./support/setup.js";

const FIXED_NOW = new Date("2026-04-01T03:00:00.000Z"); // JST 2026-04-01 12:00

interface RequestLike {
  request: (path: string, init?: RequestInit) => Promise<Response> | Response;
}

async function grantAnnual(db: Database, params: { tenantId: string; userId: string }) {
  return insertLeaveGrant(db, {
    tenantId: params.tenantId,
    userId: params.userId,
    leaveType: "annual",
    grantedOn: "2026-01-01",
    days: 20, // 20日×480分=9600分。容量としては十分で、上限のみが効くようにする
    expiresOn: "2028-01-01",
    source: "manual",
    createdAt: 0,
  });
}

async function enableHourly(app: RequestLike, cookie: string): Promise<void> {
  const res = await app.request("/settings/leave", {
    method: "PUT",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({
      grantMethod: "statutory",
      hourlyLeaveEnabled: true,
      hourlyLeaveMaxDays: 5,
      halfDayLeaveEnabled: true,
      stockConversionEnabled: false,
      stockMaxDays: 40,
      stockExpiresMonths: null,
    }),
  });
  expect(res.status).toBe(200);
}

interface LeaveRequestJson {
  id: string;
}

/** 2026-08-23: 承認は leave.request.approve 権限ベースに統一(自己承認も対象)されたため、
 * 呼び出し前に db・tenantId・userId を渡して権限を付与する。 */
async function createAndApprove(
  app: RequestLike,
  cookie: string,
  leaveDate: string,
  minutes: number,
  db: Database,
  params: { tenantId: string; userId: string },
): Promise<void> {
  await grantPermission(db, { tenantId: params.tenantId, userId: params.userId, permission: "leave.request.approve", scope: "tenant" });

  const createRes = await app.request("/leave/requests", {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ leaveDate, reason: "通院のため", unit: "hourly", minutes }),
  });
  expect(createRes.status).toBe(201);
  const created = ((await createRes.json()) as { request: LeaveRequestJson }).request;
  const approveRes = await app.request(`/leave/requests/${created.id}/approve`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({}),
  });
  expect(approveRes.status).toBe(200);
}

describe("hourly leave caps", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("rejects a same-day sum of hourly requests that exceeds the day's standard minutes (exceeds_daily_hours)", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantAnnual(db, { tenantId, userId });
    await grantPermission(db, { tenantId, userId, permission: "leave.grant.manage", scope: "tenant" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);
    await enableHourly(app, cookie);

    const first = await app.request("/leave/requests", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ leaveDate: "2026-04-10", reason: "通院1", unit: "hourly", minutes: 300 }),
    });
    expect(first.status).toBe(201);

    const second = await app.request("/leave/requests", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ leaveDate: "2026-04-10", reason: "通院2", unit: "hourly", minutes: 300 }),
    });
    expect(second.status).toBe(409);
    expect(await second.json()).toEqual({ error: "exceeds_daily_hours" });
  });

  it("rejects an hourly request that would push the fiscal-year total over the annual cap (hourly_limit_exceeded), even with ample grant capacity", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantAnnual(db, { tenantId, userId });
    await grantPermission(db, { tenantId, userId, permission: "leave.grant.manage", scope: "tenant" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);
    await enableHourly(app, cookie);

    // 所定480分 → 1日分は8時間(切り上げ不要)。上限日数5日 → 2400分。
    // 480分ずつ5日分(=2400分ちょうど)を承認済みにする。
    const dates = ["2026-04-06", "2026-04-07", "2026-04-08", "2026-04-09", "2026-04-10"];
    for (const date of dates) {
      await createAndApprove(app, cookie, date, 480, db, { tenantId, userId });
    }

    // 6件目(別日)はどんなに小さくても年度上限を超えるため拒否される
    const sixth = await app.request("/leave/requests", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ leaveDate: "2026-04-13", reason: "通院6", unit: "hourly", minutes: 60 }),
    });
    expect(sixth.status).toBe(409);
    expect(await sixth.json()).toEqual({ error: "hourly_limit_exceeded" });
  });

  it("half-day and full-day leave taken alongside heavy hourly usage do not consume the hourly-only cap", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantAnnual(db, { tenantId, userId });
    await grantPermission(db, { tenantId, userId, permission: "leave.grant.manage", scope: "tenant" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);
    await enableHourly(app, cookie);

    // 上限ちょうどまで時間単位を使い切る
    const dates = ["2026-04-06", "2026-04-07", "2026-04-08", "2026-04-09", "2026-04-10"];
    for (const date of dates) {
      await createAndApprove(app, cookie, date, 480, db, { tenantId, userId });
    }

    // 上限を使い切った後でも、半休・全休は問題なく申請できる(上限判定の対象外)
    const halfDay = await app.request("/leave/requests", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ leaveDate: "2026-04-14", reason: "午前休", unit: "half_day_am" }),
    });
    expect(halfDay.status).toBe(201);

    const fullDay = await app.request("/leave/requests", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ leaveDate: "2026-04-15", reason: "全休" }),
    });
    expect(fullDay.status).toBe(201);
  });
});

describe("mandatory five-day tracking excludes hourly usage and includes half-days at 0.5", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("taking 40 hours (5 days worth) via hourly leave satisfies 0 of the 5-day obligation", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await insertLeaveGrant(db, {
      tenantId,
      userId,
      leaveType: "annual",
      grantedOn: "2026-01-01",
      days: 10, // 10日以上 → 年5日義務の対象
      expiresOn: "2028-01-01",
      source: "manual",
      createdAt: 0,
    });
    await grantPermission(db, { tenantId, userId, permission: "leave.grant.manage", scope: "tenant" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);
    await enableHourly(app, cookie);

    const dates = ["2026-04-06", "2026-04-07", "2026-04-08", "2026-04-09", "2026-04-10"];
    for (const date of dates) {
      await createAndApprove(app, cookie, date, 480, db, { tenantId, userId });
    }

    const res = await app.request("/leave/balance", { headers: { cookie } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { mandatoryFiveDays: { taken: number; shortage: number; satisfied: boolean }[] };
    expect(body.mandatoryFiveDays).toHaveLength(1);
    expect(body.mandatoryFiveDays[0]?.taken).toBe(0);
    expect(body.mandatoryFiveDays[0]?.shortage).toBe(5);
    expect(body.mandatoryFiveDays[0]?.satisfied).toBe(false);
  });

  it("10 half-day takings (0.5 each) satisfy the 5-day obligation", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
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
    // 2026-08-23: 承認は leave.request.approve 権限ベースに統一(自己承認も対象)。
    await grantPermission(db, { tenantId, userId, permission: "leave.request.approve", scope: "tenant" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    for (let i = 0; i < 10; i++) {
      const date = `2026-04-${String(6 + i).padStart(2, "0")}`;
      const createRes = await app.request("/leave/requests", {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ leaveDate: date, reason: "半休", unit: "half_day_am" }),
      });
      expect(createRes.status).toBe(201);
      const created = ((await createRes.json()) as { request: LeaveRequestJson }).request;
      const approveRes = await app.request(`/leave/requests/${created.id}/approve`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({}),
      });
      expect(approveRes.status).toBe(200);
    }

    const res = await app.request("/leave/balance", { headers: { cookie } });
    const body = (await res.json()) as { mandatoryFiveDays: { taken: number; shortage: number; satisfied: boolean }[] };
    expect(body.mandatoryFiveDays[0]?.taken).toBe(5);
    expect(body.mandatoryFiveDays[0]?.satisfied).toBe(true);
  });
});
