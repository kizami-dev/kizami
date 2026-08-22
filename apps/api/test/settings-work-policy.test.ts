import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { auditLogs } from "@kizami/db";
import { createApp } from "../src/app.js";
import { grantPermission, jstMinutes, loginAndGetCookie, setupTestDb } from "./support/setup.js";

const PERMISSION = "tenant_settings.flex.manage";

const FIXED_NOW = new Date("2026-04-15T03:00:00.000Z"); // JST 2026-04-15 12:00

describe("GET/POST /settings/work-policy", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("GET returns 403 without tenant_settings.flex.manage", async () => {
    const { db, email, password } = await setupTestDb();
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const res = await app.request("/settings/work-policy", { headers: { cookie } });
    expect(res.status).toBe(403);
  });

  it("POST returns 403 without tenant_settings.flex.manage", async () => {
    const { db, email, password } = await setupTestDb();
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const res = await app.request("/settings/work-policy", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ effectiveFrom: "2026-05-01", settlementPeriod: "monthly", standardDayMinutes: 480 }),
    });
    expect(res.status).toBe(403);
  });

  it("GET returns the seeded version (standardDayMinutes=480) as effective and history", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: PERMISSION, scope: "tenant" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const res = await app.request("/settings/work-policy", { headers: { cookie } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.effective).toEqual({ effectiveFrom: "1970-01-01", settlementPeriod: "monthly", standardDayMinutes: 480, createdAt: 0 });
    expect(body.history).toHaveLength(1);
  });

  it("POST rejects an effectiveFrom before today with 409 effective_from_in_past", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: PERMISSION, scope: "tenant" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const res = await app.request("/settings/work-policy", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ effectiveFrom: "2026-04-14", settlementPeriod: "monthly", standardDayMinutes: 480 }),
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "effective_from_in_past" });
  });

  it("POST rejects an unsupported settlementPeriod with 400", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: PERMISSION, scope: "tenant" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const res = await app.request("/settings/work-policy", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ effectiveFrom: "2026-05-01", settlementPeriod: "yearly", standardDayMinutes: 480 }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_settlement_period" });
  });

  it("POST rejects a duplicate effectiveFrom with 409 version_already_exists", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: PERMISSION, scope: "tenant" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const body = { effectiveFrom: "2026-05-01", settlementPeriod: "monthly", standardDayMinutes: 420 };
    const first = await app.request("/settings/work-policy", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify(body),
    });
    expect(first.status).toBe(201);

    const second = await app.request("/settings/work-policy", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify(body),
    });
    expect(second.status).toBe(409);
    expect(await second.json()).toEqual({ error: "version_already_exists" });
  });

  it("POST creates a new version, records an audit log entry, and history reflects both versions in order", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: PERMISSION, scope: "tenant" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const res = await app.request("/settings/work-policy", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ effectiveFrom: "2026-05-01", settlementPeriod: "monthly", standardDayMinutes: 420 }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.version.standardDayMinutes).toBe(420);

    const rows = await db.select().from(auditLogs).where(eq(auditLogs.tenantId, tenantId));
    expect(rows.some((r) => r.action === "work_policy_version.create")).toBe(true);

    const getRes = await app.request("/settings/work-policy", { headers: { cookie } });
    const getBody = await getRes.json();
    expect(getBody.history.map((v: { effectiveFrom: string }) => v.effectiveFrom)).toEqual(["1970-01-01", "2026-05-01"]);
    // "今日"(2026-04-15)時点の実効値はまだ旧版のまま(新版は5月から)。
    expect(getBody.effective.standardDayMinutes).toBe(480);
  });

  it("effective-dated invariant: adding a future version does not change an already-past month's flex balance", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: PERMISSION, scope: "tenant" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const punch = async (kind: string, occurredAt: number) => {
      const r = await app.request("/punches", {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ kind, occurredAt }),
      });
      expect(r.status).toBe(201);
    };
    await punch("clock_in", jstMinutes(2026, 4, 1, 9, 0));
    await punch("clock_out", jstMinutes(2026, 4, 1, 18, 0));

    const before = await app.request("/attendance/monthly?month=2026-04", { headers: { cookie } });
    const beforeBody = await before.json();

    const post = await app.request("/settings/work-policy", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ effectiveFrom: "2026-05-01", settlementPeriod: "monthly", standardDayMinutes: 360 }),
    });
    expect(post.status).toBe(201);

    const after = await app.request("/attendance/monthly?month=2026-04", { headers: { cookie } });
    const afterBody = await after.json();

    expect(afterBody.flexBalance).toEqual(beforeBody.flexBalance);
    expect(afterBody.totals).toEqual(beforeBody.totals);
  });
});
