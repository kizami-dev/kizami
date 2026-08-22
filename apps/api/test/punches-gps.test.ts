/**
 * GPS付き打刻(v0.4、docs/requirements.md §3)。
 *
 * - テナントでGPSが無効なら、クライアントが座標を送っても保存されない(サーバー側で再確認する)
 * - テナントでGPSが有効なときのみ座標が meta_gps_lat/meta_gps_lng に保存される
 * - 座標の形式が不正なら 400
 * - 座標を省略しても打刻自体は成功する(許可されなかった/取得できなかった場合の既定動作)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getPunchEventById } from "@kizami/db";
import { createApp } from "../src/app.js";
import { grantPermission, loginAndGetCookie, setupTestDb } from "./support/setup.js";

const CALENDAR_PERMISSION = "tenant_settings.calendar.manage";
const GPS_PERMISSION = "tenant_settings.gps.manage";

// JST 2026-06-15 12:00(日界0時なので同日に解決される、既存 punches.test.ts と同じ時刻)。
const FIXED_NOW = new Date("2026-06-15T03:00:00.000Z");

async function enableTenantGps(
  app: ReturnType<typeof createApp>,
  cookie: string,
  overrides: { gpsRetentionDays?: number | null } = {},
) {
  const res = await app.request("/settings/attendance", {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({
      effectiveFrom: "2026-06-15",
      dayBoundaryMinutes: 0,
      legalHolidayRule: { kind: "weekday", weekday: 0 },
      breakRule: { mode: "punch" },
      gpsEnabled: true,
      gpsRetentionDays: overrides.gpsRetentionDays ?? null,
    }),
  });
  expect(res.status).toBe(201);
}

describe("POST /punches with GPS coordinates", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not persist coordinates when the tenant has GPS disabled (default)", async () => {
    const { db, email, password } = await setupTestDb();
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const res = await app.request("/punches", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ kind: "clock_in", gpsLat: 35.6812, gpsLng: 139.7671 }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();

    const stored = await getPunchEventById(db, body.punch.id);
    expect(stored?.metaGpsLat).toBeNull();
    expect(stored?.metaGpsLng).toBeNull();
  });

  it("persists coordinates when the tenant has GPS enabled", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: CALENDAR_PERMISSION, scope: "tenant" });
    await grantPermission(db, { tenantId, userId, permission: GPS_PERMISSION, scope: "tenant" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    await enableTenantGps(app, cookie);

    const res = await app.request("/punches", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ kind: "clock_in", gpsLat: 35.6812, gpsLng: 139.7671 }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();

    const stored = await getPunchEventById(db, body.punch.id);
    expect(stored?.metaGpsLat).toBeCloseTo(35.6812);
    expect(stored?.metaGpsLng).toBeCloseTo(139.7671);
  });

  it("still succeeds without coordinates even when the tenant has GPS enabled (permission denied / unavailable)", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: CALENDAR_PERMISSION, scope: "tenant" });
    await grantPermission(db, { tenantId, userId, permission: GPS_PERMISSION, scope: "tenant" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    await enableTenantGps(app, cookie);

    const res = await app.request("/punches", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ kind: "clock_in" }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();

    const stored = await getPunchEventById(db, body.punch.id);
    expect(stored?.metaGpsLat).toBeNull();
    expect(stored?.metaGpsLng).toBeNull();
  });

  it("rejects an out-of-range latitude with 400 invalid_gps_coordinates", async () => {
    const { db, email, password } = await setupTestDb();
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const res = await app.request("/punches", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ kind: "clock_in", gpsLat: 200, gpsLng: 139.7671 }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_gps_coordinates" });
  });

  it("rejects a longitude given without a latitude with 400 invalid_gps_coordinates", async () => {
    const { db, email, password } = await setupTestDb();
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const res = await app.request("/punches", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ kind: "clock_in", gpsLng: 139.7671 }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_gps_coordinates" });
  });
});

describe("GET /settings/attendance/capabilities", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("is readable by an authenticated user without any permission grant, and defaults to gpsEnabled: false", async () => {
    const { db, email, password } = await setupTestDb();
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const res = await app.request("/settings/attendance/capabilities", { headers: { cookie } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ gpsEnabled: false, gpsRetentionDays: null });
  });

  it("reflects the tenant's effective GPS setting once enabled", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: CALENDAR_PERMISSION, scope: "tenant" });
    await grantPermission(db, { tenantId, userId, permission: GPS_PERMISSION, scope: "tenant" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    await enableTenantGps(app, cookie, { gpsRetentionDays: 30 });

    const res = await app.request("/settings/attendance/capabilities", { headers: { cookie } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ gpsEnabled: true, gpsRetentionDays: 30 });
  });

  it("rejects an unauthenticated request with 401", async () => {
    const { db } = await setupTestDb();
    const app = createApp({ db });

    const res = await app.request("/settings/attendance/capabilities");
    expect(res.status).toBe(401);
  });
});
