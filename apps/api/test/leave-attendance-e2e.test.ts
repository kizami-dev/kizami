/**
 * 最重要 E2E: 休暇申請→承認→月次集計で有給日が所定労働扱いになることを検証する
 * (docs/requirements.md §5「集計との連動」)。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { insertLeaveGrant, type Database } from "@kizami/db";
import { createApp } from "../src/app.js";
import { grantPermission, loginAndGetCookie, setupTestDb } from "./support/setup.js";

const FIXED_NOW = new Date("2026-04-15T03:00:00.000Z"); // JST 2026-04-15 12:00

async function grantAnnual(db: Database, params: { tenantId: string; userId: string }) {
  return insertLeaveGrant(db, {
    tenantId: params.tenantId,
    userId: params.userId,
    leaveType: "annual",
    grantedOn: "2020-01-01",
    days: 20,
    expiresOn: "2099-01-01",
    source: "manual",
    createdAt: 0,
  });
}

interface LeaveRequestJson {
  id: string;
}

/** 2026-08-23: 承認は leave.request.approve 権限ベースに統一(自己承認も対象)されたため、
 * 呼び出し前に db・tenantId・userId を渡して権限を付与する。 */
async function createAndApprove(
  app: { request: (path: string, init?: RequestInit) => Promise<Response> | Response },
  cookie: string,
  body: Record<string, unknown>,
  db: Database,
  params: { tenantId: string; userId: string },
): Promise<void> {
  await grantPermission(db, { tenantId: params.tenantId, userId: params.userId, permission: "leave.request.approve", scope: "tenant" });

  const createRes = await app.request("/leave/requests", {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify(body),
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

describe("leave -> monthly flex integration (E2E)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("an approved full-day leave adds standardDayMinutes(480) to the month's flex actual", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantAnnual(db, { tenantId, userId });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const before = await app.request("/attendance/monthly?month=2026-04", { headers: { cookie } });
    const beforeBody = (await before.json()) as { figures: { flexBalance: { actualMinutes: number } } };
    expect(beforeBody.figures.flexBalance.actualMinutes).toBe(0);

    await createAndApprove(app, cookie, { leaveDate: "2026-04-10", reason: "私用のため" }, db, { tenantId, userId });

    const after = await app.request("/attendance/monthly?month=2026-04", { headers: { cookie } });
    const afterBody = (await after.json()) as { figures: { flexBalance: { actualMinutes: number } }; days: { date: string; isPaidLeave: boolean }[] };
    expect(afterBody.figures.flexBalance.actualMinutes).toBe(480);
    const day = afterBody.days.find((d) => d.date === "2026-04-10");
    expect(day?.isPaidLeave).toBe(true);
  });

  it("an approved morning half-day leave adds half of standardDayMinutes(240) to the month's flex actual", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantAnnual(db, { tenantId, userId });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    await createAndApprove(app, cookie, { leaveDate: "2026-04-11", reason: "午前休", unit: "half_day_am" }, db, { tenantId, userId });

    const res = await app.request("/attendance/monthly?month=2026-04", { headers: { cookie } });
    const body = (await res.json()) as { figures: { flexBalance: { actualMinutes: number } } };
    expect(body.figures.flexBalance.actualMinutes).toBe(240);
  });

  it("an approved hourly leave (3 hours) adds 180 minutes to the month's flex actual", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantAnnual(db, { tenantId, userId });
    await grantPermission(db, { tenantId, userId, permission: "leave.grant.manage", scope: "tenant" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const settingsRes = await app.request("/settings/leave", {
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
    expect(settingsRes.status).toBe(200);

    await createAndApprove(app, cookie, { leaveDate: "2026-04-12", reason: "通院のため", unit: "hourly", minutes: 180 }, db, { tenantId, userId });

    const res = await app.request("/attendance/monthly?month=2026-04", { headers: { cookie } });
    const body = (await res.json()) as { figures: { flexBalance: { actualMinutes: number } } };
    expect(body.figures.flexBalance.actualMinutes).toBe(180);
  });

  it("a full worked day plus a half-day leave in the same month sum correctly in the flex actual", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantAnnual(db, { tenantId, userId });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    // 9:00-18:00 JST(休憩なし、9時間=540分)の勤務を1日分登録
    const clockInAt = Math.floor(Date.UTC(2026, 3, 1, 0, 0) / 60_000); // 2026-04-01 09:00 JST
    const clockOutAt = Math.floor(Date.UTC(2026, 3, 1, 9, 0) / 60_000); // 2026-04-01 18:00 JST
    await app.request("/punches", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ kind: "clock_in", occurredAt: clockInAt }),
    });
    await app.request("/punches", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ kind: "clock_out", occurredAt: clockOutAt }),
    });

    await createAndApprove(app, cookie, { leaveDate: "2026-04-13", reason: "午後休", unit: "half_day_pm" }, db, { tenantId, userId });

    const res = await app.request("/attendance/monthly?month=2026-04", { headers: { cookie } });
    const body = (await res.json()) as { figures: { flexBalance: { actualMinutes: number } } };
    expect(body.figures.flexBalance.actualMinutes).toBe(540 + 240);
  });
});
