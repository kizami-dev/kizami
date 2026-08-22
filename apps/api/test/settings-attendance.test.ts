import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { auditLogs } from "@kizami/db";
import { createApp } from "../src/app.js";
import { grantPermission, jstMinutes, loginAndGetCookie, setupTestDb } from "./support/setup.js";

const CALENDAR_PERMISSION = "tenant_settings.calendar.manage";
const GPS_PERMISSION = "tenant_settings.gps.manage";

// 期間内の安全な時刻に固定する(attendance-monthly.test.ts と同じ流儀)。
// JST では 2026-04-15 12:00。"今日" は 2026-04-15、effectiveFrom はこれ以降のみ許可される。
const FIXED_NOW = new Date("2026-04-15T03:00:00.000Z");

const VALID_BODY = {
  effectiveFrom: "2026-05-01",
  dayBoundaryMinutes: 300, // 05:00
  legalHolidayRule: { kind: "weekday", weekday: 6 },
  breakRule: { mode: "punch" },
  gpsEnabled: false,
  gpsRetentionDays: null,
};

describe("GET/POST /settings/attendance", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("GET returns 403 without tenant_settings.calendar.manage", async () => {
    const { db, email, password } = await setupTestDb();
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const res = await app.request("/settings/attendance", { headers: { cookie } });
    expect(res.status).toBe(403);
  });

  it("POST returns 403 without tenant_settings.calendar.manage", async () => {
    const { db, email, password } = await setupTestDb();
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const res = await app.request("/settings/attendance", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify(VALID_BODY),
    });
    expect(res.status).toBe(403);
  });

  it("GET returns the seeded version as both effective and the sole history entry", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: CALENDAR_PERMISSION, scope: "tenant" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const res = await app.request("/settings/attendance", { headers: { cookie } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.effective.effectiveFrom).toBe("1970-01-01");
    expect(body.history).toHaveLength(1);
    expect(body.history[0].effectiveFrom).toBe("1970-01-01");
  });

  it("POST rejects an effectiveFrom before today with 409 effective_from_in_past", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: CALENDAR_PERMISSION, scope: "tenant" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const res = await app.request("/settings/attendance", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ ...VALID_BODY, effectiveFrom: "2026-04-14" }),
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "effective_from_in_past" });
  });

  it("POST accepts today as effectiveFrom (boundary)", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: CALENDAR_PERMISSION, scope: "tenant" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const res = await app.request("/settings/attendance", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ ...VALID_BODY, effectiveFrom: "2026-04-15" }),
    });
    expect(res.status).toBe(201);
  });

  it("POST rejects a duplicate effectiveFrom with 409 version_already_exists", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: CALENDAR_PERMISSION, scope: "tenant" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const first = await app.request("/settings/attendance", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify(VALID_BODY),
    });
    expect(first.status).toBe(201);

    const second = await app.request("/settings/attendance", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ ...VALID_BODY, dayBoundaryMinutes: 0 }),
    });
    expect(second.status).toBe(409);
    expect(await second.json()).toEqual({ error: "version_already_exists" });
  });

  it("POST changing only calendar fields (GPS unchanged) succeeds with calendar.manage alone", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: CALENDAR_PERMISSION, scope: "tenant" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    // setupTestDb の既定値: gpsEnabled=false, gpsRetentionDays=null と一致させる(VALID_BODY のまま)。
    const res = await app.request("/settings/attendance", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify(VALID_BODY),
    });
    expect(res.status).toBe(201);
  });

  it("POST enabling GPS without tenant_settings.gps.manage returns 403", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: CALENDAR_PERMISSION, scope: "tenant" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const res = await app.request("/settings/attendance", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ ...VALID_BODY, gpsEnabled: true, gpsRetentionDays: 30 }),
    });
    expect(res.status).toBe(403);
  });

  it("POST enabling GPS with both calendar.manage and gps.manage succeeds and is recorded in the audit log", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: CALENDAR_PERMISSION, scope: "tenant" });
    await grantPermission(db, { tenantId, userId, permission: GPS_PERMISSION, scope: "tenant" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const res = await app.request("/settings/attendance", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ ...VALID_BODY, gpsEnabled: true, gpsRetentionDays: 30 }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.version.gpsEnabled).toBe(true);
    expect(body.version.gpsRetentionDays).toBe(30);

    const rows = await db.select().from(auditLogs).where(eq(auditLogs.tenantId, tenantId));
    const entry = rows.find((r) => r.action === "tenant_setting_version.create");
    expect(entry).toBeDefined();
    const detail = JSON.parse(entry?.afterDigest ?? "{}");
    expect(detail.before.gpsEnabled).toBe(false);
    expect(detail.after.gpsEnabled).toBe(true);
  });

  it("POST rejects invalid legalHolidayRule and breakRule shapes", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: CALENDAR_PERMISSION, scope: "tenant" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const badHoliday = await app.request("/settings/attendance", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ ...VALID_BODY, legalHolidayRule: { kind: "weekday", weekday: 9 } }),
    });
    expect(badHoliday.status).toBe(400);
    expect(await badHoliday.json()).toEqual({ error: "invalid_legal_holiday_rule" });

    const badBreak = await app.request("/settings/attendance", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ ...VALID_BODY, breakRule: { mode: "auto" } }),
    });
    expect(badBreak.status).toBe(400);
    expect(await badBreak.json()).toEqual({ error: "invalid_break_rule" });
  });

  it("history lists multiple versions in ascending effectiveFrom order after two POSTs", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: CALENDAR_PERMISSION, scope: "tenant" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    await app.request("/settings/attendance", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ ...VALID_BODY, effectiveFrom: "2026-05-01" }),
    });
    await app.request("/settings/attendance", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ ...VALID_BODY, effectiveFrom: "2026-06-01" }),
    });

    const res = await app.request("/settings/attendance", { headers: { cookie } });
    const body = await res.json();
    expect(body.history.map((v: { effectiveFrom: string }) => v.effectiveFrom)).toEqual(["1970-01-01", "2026-05-01", "2026-06-01"]);
  });

  it("effective-dated invariant: adding a future version does not change an already-past month's aggregation", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: CALENDAR_PERMISSION, scope: "tenant" });
    await grantPermission(db, { tenantId, userId, permission: GPS_PERMISSION, scope: "tenant" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const punches = [
      { kind: "clock_in", occurredAt: jstMinutes(2026, 4, 1, 9, 0) },
      { kind: "clock_out", occurredAt: jstMinutes(2026, 4, 1, 18, 0) },
      { kind: "clock_in", occurredAt: jstMinutes(2026, 4, 5, 9, 0) }, // 日曜(法定休日)出勤
      { kind: "clock_out", occurredAt: jstMinutes(2026, 4, 5, 18, 0) },
      { kind: "clock_in", occurredAt: jstMinutes(2026, 4, 10, 20, 0) }, // 深夜勤務
      { kind: "clock_out", occurredAt: jstMinutes(2026, 4, 10, 23, 0) },
    ];
    for (const p of punches) {
      const res = await app.request("/punches", {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify(p),
      });
      expect(res.status).toBe(201);
    }

    const before = await app.request("/attendance/monthly?month=2026-04", { headers: { cookie } });
    expect(before.status).toBe(200);
    const beforeBody = await before.json();

    // 日界を05:00に・法定休日を土曜に・GPSを有効化する新しい版を「翌月から」追加する。
    // これは effectiveFrom=2026-05-01 の版であり、2026-04 の計算には一切影響しないはず
    // (docs/design/v01-data-model.md 原則6: 過去の計算は「その日に有効だった版」で行われる)。
    const post = await app.request("/settings/attendance", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        effectiveFrom: "2026-05-01",
        dayBoundaryMinutes: 300,
        legalHolidayRule: { kind: "weekday", weekday: 6 },
        breakRule: { mode: "punch" },
        gpsEnabled: true,
        gpsRetentionDays: 30,
      }),
    });
    expect(post.status).toBe(201);

    const after = await app.request("/attendance/monthly?month=2026-04", { headers: { cookie } });
    expect(after.status).toBe(200);
    const afterBody = await after.json();

    expect(afterBody.totals).toEqual(beforeBody.totals);
    expect(afterBody.flexBalance).toEqual(beforeBody.flexBalance);
    expect(afterBody.days).toEqual(beforeBody.days);
    expect(afterBody.warnings).toEqual(beforeBody.warnings);
  });
});
