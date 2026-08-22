import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { insertLeaveGrant } from "@kizami/db";
import { createApp } from "../src/app.js";
import { grantPermission, loginAndGetCookie, setupTestDb } from "./support/setup.js";

const FIXED_NOW = new Date("2022-07-15T03:00:00.000Z"); // JST 2022-07-15 12:00

interface RequestLike {
  request: (path: string, init?: RequestInit) => Promise<Response> | Response;
}

async function enableStockConversion(app: RequestLike, cookie: string, stockMaxDays = 40): Promise<void> {
  const res = await app.request("/settings/leave", {
    method: "PUT",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({
      grantMethod: "statutory",
      hourlyLeaveEnabled: false,
      hourlyLeaveMaxDays: 5,
      halfDayLeaveEnabled: true,
      stockConversionEnabled: true,
      stockMaxDays,
      stockExpiresMonths: null,
    }),
  });
  expect(res.status).toBe(200);
}

interface ConversionResultJson {
  sourceGrantId: string;
  leftoverMinutes: number;
  leftoverDays: number;
  convertedDays: number;
  truncatedDays: number;
}
interface LeaveGrantJson {
  leaveType: string;
  days: number;
  source: string;
  convertedFromGrantId: string | null;
}

describe("POST /leave/grants/convert-expired", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("requires stockConversionEnabled (400 stock_conversion_disabled otherwise)", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: "leave.grant.manage", scope: "tenant" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const res = await app.request("/leave/grants/convert-expired", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ userId }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "stock_conversion_disabled" });
  });

  it("converts unused leftover from an expired annual grant into a stocked grant, and is idempotent on re-run", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: "leave.grant.manage", scope: "tenant" });
    // 2022-07-01 に失効(FIXED_NOW=2022-07-15 は失効後)。10日中 使用0日 → 未消化10日
    const grant = await insertLeaveGrant(db, {
      tenantId,
      userId,
      leaveType: "annual",
      grantedOn: "2020-07-01",
      days: 10,
      expiresOn: "2022-07-01",
      source: "manual",
      createdAt: 0,
    });

    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);
    await enableStockConversion(app, cookie);

    const firstRes = await app.request("/leave/grants/convert-expired", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ userId }),
    });
    expect(firstRes.status).toBe(201);
    const firstBody = (await firstRes.json()) as { conversions: ConversionResultJson[]; created: LeaveGrantJson[] };
    expect(firstBody.conversions).toEqual([
      { sourceGrantId: grant.id, leftoverMinutes: 4800, leftoverDays: 10, convertedDays: 10, truncatedDays: 0 },
    ]);
    expect(firstBody.created).toHaveLength(1);
    expect(firstBody.created[0]).toMatchObject({ leaveType: "stocked", days: 10, source: "conversion", convertedFromGrantId: grant.id });

    // 残高の stocked が10日分(4800分)になっている
    const balanceRes = await app.request("/leave/balance", { headers: { cookie } });
    const balance = (await balanceRes.json()) as { stocked: { remainingMinutes: number } };
    expect(balance.stocked.remainingMinutes).toBe(10 * 480);

    // 再実行しても二重に変換しない
    const secondRes = await app.request("/leave/grants/convert-expired", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ userId }),
    });
    expect(secondRes.status).toBe(201);
    const secondBody = (await secondRes.json()) as { conversions: ConversionResultJson[] };
    expect(secondBody.conversions).toEqual([]);

    const balanceRes2 = await app.request("/leave/balance", { headers: { cookie } });
    const balance2 = (await balanceRes2.json()) as { stocked: { remainingMinutes: number } };
    expect(balance2.stocked.remainingMinutes).toBe(10 * 480); // 変わらない
  });

  it("truncates the conversion at the tenant's stock cap and reports the truncated days", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: "leave.grant.manage", scope: "tenant" });
    const grant = await insertLeaveGrant(db, {
      tenantId,
      userId,
      leaveType: "annual",
      grantedOn: "2020-07-01",
      days: 10,
      expiresOn: "2022-07-01",
      source: "manual",
      createdAt: 0,
    });

    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);
    await enableStockConversion(app, cookie, 6); // 上限6日 < 未消化10日

    const res = await app.request("/leave/grants/convert-expired", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ userId }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { conversions: ConversionResultJson[] };
    expect(body.conversions).toEqual([
      { sourceGrantId: grant.id, leftoverMinutes: 4800, leftoverDays: 10, convertedDays: 6, truncatedDays: 4 },
    ]);
  });

  it("stocked leave can be requested and consumed once converted", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: "leave.grant.manage", scope: "tenant" });
    await insertLeaveGrant(db, {
      tenantId,
      userId,
      leaveType: "annual",
      grantedOn: "2020-07-01",
      days: 10,
      expiresOn: "2022-07-01",
      source: "manual",
      createdAt: 0,
    });

    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);
    await enableStockConversion(app, cookie);

    const convertRes = await app.request("/leave/grants/convert-expired", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ userId }),
    });
    expect(convertRes.status).toBe(201);

    const requestRes = await app.request("/leave/requests", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ leaveDate: "2022-08-01", reason: "積立休暇の利用", leaveType: "stocked" }),
    });
    expect(requestRes.status).toBe(201);
  });
});
