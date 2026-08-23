/**
 * GET/POST /settings/allowances, POST /settings/allowances/:definitionId/versions のテスト。
 * 参照: apps/api/src/routes/settings.ts、docs/design/allowances.md。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { auditLogs } from "@kizami/db";
import { createApp } from "../src/app.js";
import { grantPermission, loginAndGetCookie, setupTestDb } from "./support/setup.js";

const PERMISSION = "tenant_settings.calendar.manage";

const FIXED_NOW = new Date("2026-04-15T03:00:00.000Z"); // JST 2026-04-15 12:00

const VALID_BODY = {
  effectiveFrom: "2026-05-01",
  name: "早朝手当",
  conditions: { timeBand: { startMinutes: 360, endMinutes: 480 } },
};

describe("GET/POST /settings/allowances", () => {
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

    const res = await app.request("/settings/allowances", { headers: { cookie } });
    expect(res.status).toBe(403);
  });

  it("POST returns 403 without tenant_settings.calendar.manage", async () => {
    const { db, email, password } = await setupTestDb();
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const res = await app.request("/settings/allowances", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify(VALID_BODY),
    });
    expect(res.status).toBe(403);
  });

  it("GET returns an empty list for a tenant with no allowance definitions", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: PERMISSION, scope: "tenant" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const res = await app.request("/settings/allowances", { headers: { cookie } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ definitions: [] });
  });

  it("POST creates a definition with its first version, records an audit log entry, and GET lists it", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: PERMISSION, scope: "tenant" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const res = await app.request("/settings/allowances", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify(VALID_BODY),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.version).toEqual({
      effectiveFrom: "2026-05-01",
      name: "早朝手当",
      conditions: { timeBand: { startMinutes: 360, endMinutes: 480 } },
      createdAt: expect.any(Number),
    });
    const definitionId = body.id as string;

    const rows = await db.select().from(auditLogs).where(eq(auditLogs.tenantId, tenantId));
    expect(rows.some((r) => r.action === "allowance_definition.create")).toBe(true);

    const getRes = await app.request("/settings/allowances", { headers: { cookie } });
    const getBody = await getRes.json();
    expect(getBody.definitions).toHaveLength(1);
    expect(getBody.definitions[0].id).toBe(definitionId);
    // "今日"(2026-04-15)時点ではまだ有効になっていない(2026-05-01 から)。
    expect(getBody.definitions[0].effective).toBeNull();
    expect(getBody.definitions[0].history).toHaveLength(1);
  });

  it("POST rejects a missing name with 400 invalid_name", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: PERMISSION, scope: "tenant" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const res = await app.request("/settings/allowances", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ ...VALID_BODY, name: "" }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_name" });
  });

  it("POST rejects conditions with all fields omitted with 400 conditions_required (意味を持たない設定)", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: PERMISSION, scope: "tenant" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const res = await app.request("/settings/allowances", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ ...VALID_BODY, conditions: {} }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "conditions_required" });
  });

  it("POST rejects a malformed dates entry (not YYYY-MM-DD or --MM-DD) with 400 invalid_conditions", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: PERMISSION, scope: "tenant" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const res = await app.request("/settings/allowances", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ ...VALID_BODY, conditions: { dates: ["Dec 31"] } }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_conditions" });
  });

  it("POST accepts both fixed-date ('2027-01-01') and yearly ('--12-31') date formats", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: PERMISSION, scope: "tenant" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const res = await app.request("/settings/allowances", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ ...VALID_BODY, conditions: { dates: ["2027-01-01", "--12-31"] } }),
    });
    expect(res.status).toBe(201);
  });

  it("POST rejects an out-of-range weekday with 400 invalid_conditions", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: PERMISSION, scope: "tenant" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const res = await app.request("/settings/allowances", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ ...VALID_BODY, conditions: { weekdays: [7] } }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_conditions" });
  });

  it("POST rejects a timeBand minute out of 0-1439 range with 400 invalid_conditions", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: PERMISSION, scope: "tenant" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const res = await app.request("/settings/allowances", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ ...VALID_BODY, conditions: { timeBand: { startMinutes: 0, endMinutes: 1440 } } }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_conditions" });
  });

  it("POST accepts a day-crossing timeBand (startMinutes > endMinutes, e.g. 22:00-6:00)", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: PERMISSION, scope: "tenant" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const res = await app.request("/settings/allowances", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ ...VALID_BODY, conditions: { timeBand: { startMinutes: 1320, endMinutes: 360 } } }),
    });
    expect(res.status).toBe(201);
  });

  it("POST rejects an effectiveFrom before today with 409 effective_from_in_past", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: PERMISSION, scope: "tenant" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const res = await app.request("/settings/allowances", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ ...VALID_BODY, effectiveFrom: "2026-04-14" }),
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "effective_from_in_past" });
  });

  describe("POST /settings/allowances/:definitionId/versions", () => {
    it("returns 404 for an unknown definitionId", async () => {
      const { db, tenantId, userId, email, password } = await setupTestDb();
      await grantPermission(db, { tenantId, userId, permission: PERMISSION, scope: "tenant" });
      const app = createApp({ db });
      const cookie = await loginAndGetCookie(app, email, password);

      const res = await app.request("/settings/allowances/does-not-exist/versions", {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify(VALID_BODY),
      });
      expect(res.status).toBe(404);
    });

    it("appends a new version without touching the existing one, and records an audit log entry", async () => {
      const { db, tenantId, userId, email, password } = await setupTestDb();
      await grantPermission(db, { tenantId, userId, permission: PERMISSION, scope: "tenant" });
      const app = createApp({ db });
      const cookie = await loginAndGetCookie(app, email, password);

      const createRes = await app.request("/settings/allowances", {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ ...VALID_BODY, effectiveFrom: "2026-04-15" }),
      });
      expect(createRes.status).toBe(201);
      const definitionId = (await createRes.json()).id as string;

      const versionRes = await app.request(`/settings/allowances/${definitionId}/versions`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({
          effectiveFrom: "2026-06-01",
          name: "早朝手当(改定)",
          conditions: { timeBand: { startMinutes: 300, endMinutes: 480 } },
        }),
      });
      expect(versionRes.status).toBe(201);

      const rows = await db.select().from(auditLogs).where(eq(auditLogs.tenantId, tenantId));
      expect(rows.some((r) => r.action === "allowance_definition_version.create")).toBe(true);

      const getRes = await app.request("/settings/allowances", { headers: { cookie } });
      const getBody = await getRes.json();
      const definition = getBody.definitions.find((d: { id: string }) => d.id === definitionId);
      expect(definition.history.map((v: { effectiveFrom: string; name: string }) => [v.effectiveFrom, v.name])).toEqual([
        ["2026-04-15", "早朝手当"],
        ["2026-06-01", "早朝手当(改定)"],
      ]);
      // "今日"(2026-04-15)時点の実効値は初版のまま(改定は6月から)。
      expect(definition.effective.name).toBe("早朝手当");
    });

    it("rejects a duplicate effectiveFrom with 409 version_already_exists", async () => {
      const { db, tenantId, userId, email, password } = await setupTestDb();
      await grantPermission(db, { tenantId, userId, permission: PERMISSION, scope: "tenant" });
      const app = createApp({ db });
      const cookie = await loginAndGetCookie(app, email, password);

      const createRes = await app.request("/settings/allowances", {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify(VALID_BODY),
      });
      const definitionId = (await createRes.json()).id as string;

      const res = await app.request(`/settings/allowances/${definitionId}/versions`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify(VALID_BODY), // effectiveFrom は作成時と同じ 2026-05-01
      });
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: "version_already_exists" });
    });
  });
});
