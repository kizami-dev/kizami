import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { auditLogs } from "@kizami/db";
import { createApp } from "../src/app.js";
import { grantPermission, loginAndGetCookie, setupSecondUser, setupTestDb } from "./support/setup.js";

const PERMISSION = "tenant_settings.flex.manage";

const FIXED_NOW = new Date("2026-04-15T03:00:00.000Z"); // JST 2026-04-15 12:00

describe("GET/POST /members/:id/work-policy", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("GET returns 403 without tenant_settings.flex.manage", async () => {
    const { db, userId, email, password } = await setupTestDb();
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const res = await app.request(`/members/${userId}/work-policy`, { headers: { cookie } });
    expect(res.status).toBe(403);
  });

  it("POST returns 403 without tenant_settings.flex.manage", async () => {
    const { db, userId, email, password } = await setupTestDb();
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const res = await app.request(`/members/${userId}/work-policy`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ kind: "fixed", effectiveFrom: "2026-05-01" }),
    });
    expect(res.status).toBe(403);
  });

  it("GET returns 404 for a nonexistent member", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: PERMISSION, scope: "tenant" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const res = await app.request("/members/00000000-0000-0000-0000-000000000000/work-policy", { headers: { cookie } });
    expect(res.status).toBe(404);
  });

  it("GET returns the seeded flex assignment as effective, and an empty history for a member with no assignment", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: PERMISSION, scope: "tenant" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const res = await app.request(`/members/${userId}/work-policy`, { headers: { cookie } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.effective).toEqual({ effectiveFrom: "1970-01-01", kind: "flex", standardDayMinutes: 480, workPolicyName: "Flex" });
    expect(body.history).toHaveLength(1);

    const second = await setupSecondUser(db, tenantId);
    const res2 = await app.request(`/members/${second.userId}/work-policy`, { headers: { cookie } });
    expect(res2.status).toBe(200);
    const body2 = await res2.json();
    expect(body2).toEqual({ effective: null, history: [] });
  });

  it("POST rejects an effectiveFrom before today with 409 effective_from_in_past", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: PERMISSION, scope: "tenant" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const res = await app.request(`/members/${userId}/work-policy`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ kind: "fixed", effectiveFrom: "2026-04-14" }),
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "effective_from_in_past" });
  });

  it("POST rejects an unsupported kind with 400 invalid_work_system_kind", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: PERMISSION, scope: "tenant" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const res = await app.request(`/members/${userId}/work-policy`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ kind: "yearly", effectiveFrom: "2026-05-01" }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_work_system_kind" });
  });

  it("POST rejects a duplicate effectiveFrom with 409 assignment_already_exists", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: PERMISSION, scope: "tenant" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const body = JSON.stringify({ kind: "fixed", effectiveFrom: "2026-05-01" });
    const first = await app.request(`/members/${userId}/work-policy`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body,
    });
    expect(first.status).toBe(201);

    const second = await app.request(`/members/${userId}/work-policy`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body,
    });
    expect(second.status).toBe(409);
    expect(await second.json()).toEqual({ error: "assignment_already_exists" });
  });

  it("POST assigns fixed, records an audit log entry with before/after kind, and history reflects the switch", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: PERMISSION, scope: "tenant" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const res = await app.request(`/members/${userId}/work-policy`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ kind: "fixed", effectiveFrom: "2026-05-01" }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.assignment).toEqual({ kind: "fixed", effectiveFrom: "2026-05-01", standardDayMinutes: 480 });

    const rows = await db.select().from(auditLogs).where(eq(auditLogs.tenantId, tenantId));
    const entry = rows.find((r) => r.action === "member.work_policy.assign");
    expect(entry).toBeDefined();
    expect(JSON.parse(entry?.afterDigest ?? "{}")).toEqual({ before: "flex", after: "fixed", effectiveFrom: "2026-05-01" });

    const getRes = await app.request(`/members/${userId}/work-policy`, { headers: { cookie } });
    const getBody = await getRes.json();
    expect(getBody.history.map((h: { effectiveFrom: string; kind: string }) => [h.effectiveFrom, h.kind])).toEqual([
      ["1970-01-01", "flex"],
      ["2026-05-01", "fixed"],
    ]);
    // "今日"(2026-04-15)時点の実効値はまだフレックスのまま(新版は5月から)。
    expect(getBody.effective.kind).toBe("flex");
  });

  it("GET /members lists the current workSystemKind, and it changes after a new assignment takes effect", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: PERMISSION, scope: "tenant" });
    await grantPermission(db, { tenantId, userId, permission: "member.view", scope: "tenant" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const before = await app.request("/members", { headers: { cookie } });
    const beforeBody = await before.json();
    const meBefore = beforeBody.members.find((m: { id: string }) => m.id === userId);
    expect(meBefore.workSystemKind).toBe("flex");

    // 今日(2026-04-15)から有効な割当なら、一覧にすぐ反映される。
    const post = await app.request(`/members/${userId}/work-policy`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ kind: "fixed", effectiveFrom: "2026-04-15" }),
    });
    expect(post.status).toBe(201);

    const after = await app.request("/members", { headers: { cookie } });
    const afterBody = await after.json();
    const meAfter = afterBody.members.find((m: { id: string }) => m.id === userId);
    expect(meAfter.workSystemKind).toBe("fixed");
  });

  it("flex to fixed switch is reflected by GET /attendance/monthly for the assigned user from the effective month onward", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: PERMISSION, scope: "tenant" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const post = await app.request(`/members/${userId}/work-policy`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ kind: "fixed", effectiveFrom: "2026-05-01" }),
    });
    expect(post.status).toBe(201);

    // 切り替え前の月(4月)はまだフレックス。
    const aprilRes = await app.request("/attendance/monthly?month=2026-04", { headers: { cookie } });
    expect(aprilRes.status).toBe(200);
    const aprilBody = await aprilRes.json();
    expect(aprilBody.workSystem).toBe("flex");

    // 切り替え後の月(5月)は固定時間制。
    const mayRes = await app.request("/attendance/monthly?month=2026-05", { headers: { cookie } });
    expect(mayRes.status).toBe(200);
    const mayBody = await mayRes.json();
    expect(mayBody.workSystem).toBe("fixed");
  });
});
