import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { grantPermission, loginAndGetCookie, setupTestDb } from "./support/setup.js";

describe("GET/PUT /settings/leave", () => {
  it("GET returns 403 without leave.grant.manage", async () => {
    const { db, email, password } = await setupTestDb();
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const res = await app.request("/settings/leave", { headers: { cookie } });
    expect(res.status).toBe(403);
  });

  it("GET returns statutory defaults when unset", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: "leave.grant.manage", scope: "tenant" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const res = await app.request("/settings/leave", { headers: { cookie } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      grantMethod: "statutory",
      fixedDateMmDd: null,
      hourlyLeaveEnabled: false,
      hourlyLeaveMaxDays: 5,
      halfDayLeaveEnabled: true,
      stockConversionEnabled: false,
      stockMaxDays: 40,
      stockExpiresMonths: null,
      updatedAt: null,
      updatedBy: null,
    });
  });

  it("PUT rejects an unknown grantMethod", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: "leave.grant.manage", scope: "tenant" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const res = await app.request("/settings/leave", {
      method: "PUT",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        grantMethod: "bogus",
        hourlyLeaveEnabled: false,
        hourlyLeaveMaxDays: 5,
        halfDayLeaveEnabled: true,
        stockConversionEnabled: false,
        stockMaxDays: 40,
        stockExpiresMonths: null,
      }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_grant_method" });
  });

  it("PUT requires fixedDateMmDd when grantMethod is fixed_date", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: "leave.grant.manage", scope: "tenant" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const res = await app.request("/settings/leave", {
      method: "PUT",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        grantMethod: "fixed_date",
        hourlyLeaveEnabled: false,
        hourlyLeaveMaxDays: 5,
        halfDayLeaveEnabled: true,
        stockConversionEnabled: false,
        stockMaxDays: 40,
        stockExpiresMonths: null,
      }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_fixed_date_mm_dd" });
  });

  it("PUT rejects hourlyLeaveMaxDays outside [1,5] (法令上5日超は不可)", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: "leave.grant.manage", scope: "tenant" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const base = {
      grantMethod: "statutory" as const,
      halfDayLeaveEnabled: true,
      stockConversionEnabled: false,
      stockMaxDays: 40,
      stockExpiresMonths: null,
    };

    const tooHigh = await app.request("/settings/leave", {
      method: "PUT",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ ...base, hourlyLeaveEnabled: true, hourlyLeaveMaxDays: 6 }),
    });
    expect(tooHigh.status).toBe(400);
    expect(await tooHigh.json()).toEqual({ error: "invalid_hourly_leave_max_days" });

    const tooLow = await app.request("/settings/leave", {
      method: "PUT",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ ...base, hourlyLeaveEnabled: true, hourlyLeaveMaxDays: 0 }),
    });
    expect(tooLow.status).toBe(400);
    expect(await tooLow.json()).toEqual({ error: "invalid_hourly_leave_max_days" });

    const ok = await app.request("/settings/leave", {
      method: "PUT",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ ...base, hourlyLeaveEnabled: true, hourlyLeaveMaxDays: 3 }),
    });
    expect(ok.status).toBe(200);
  });

  it("PUT persists valid settings and GET reflects them afterwards", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: "leave.grant.manage", scope: "tenant" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const putRes = await app.request("/settings/leave", {
      method: "PUT",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        grantMethod: "fixed_date",
        fixedDateMmDd: "04-01",
        hourlyLeaveEnabled: true,
        hourlyLeaveMaxDays: 3,
        halfDayLeaveEnabled: false,
        stockConversionEnabled: true,
        stockMaxDays: 20,
        stockExpiresMonths: 60,
      }),
    });
    expect(putRes.status).toBe(200);

    const getRes = await app.request("/settings/leave", { headers: { cookie } });
    const body = (await getRes.json()) as { grantMethod: string; fixedDateMmDd: string; hourlyLeaveMaxDays: number };
    expect(body.grantMethod).toBe("fixed_date");
    expect(body.fixedDateMmDd).toBe("04-01");
    expect(body.hourlyLeaveMaxDays).toBe(3);
  });
});
