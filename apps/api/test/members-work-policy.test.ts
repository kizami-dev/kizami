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
    expect(body.effective).toEqual({
      effectiveFrom: "1970-01-01",
      workPolicyId: expect.any(String),
      workPolicyName: "Flex",
      kind: "flex",
      standardDayMinutes: 480,
    });
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
    // kind 入力(後方互換)は、その kind の既定の制度(無ければ作る)に割り当てる。
    expect(body.assignment).toEqual({
      workPolicyId: expect.any(String),
      workPolicyName: "標準(固定時間制)",
      kind: "fixed",
      effectiveFrom: "2026-05-01",
      standardDayMinutes: 480,
    });

    const rows = await db.select().from(auditLogs).where(eq(auditLogs.tenantId, tenantId));
    const entry = rows.find((r) => r.action === "member.work_policy.assign");
    expect(entry).toBeDefined();
    expect(JSON.parse(entry?.afterDigest ?? "{}")).toEqual({
      before: "flex",
      after: "fixed",
      effectiveFrom: "2026-05-01",
      beforeWorkPolicyId: expect.any(String),
      beforeWorkPolicyName: "Flex",
      afterWorkPolicyId: body.assignment.workPolicyId,
      afterWorkPolicyName: "標準(固定時間制)",
    });

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
  describe("制度の id で割り当てる(2026-10-05、名前付きの制度)", () => {
    async function createPolicy(app: ReturnType<typeof createApp>, cookie: string, body: Record<string, unknown>): Promise<string> {
      const res = await app.request("/settings/work-policies", {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify(body),
      });
      expect(res.status).toBe(201);
      return ((await res.json()) as { policy: { id: string } }).policy.id;
    }

    function assign(app: ReturnType<typeof createApp>, cookie: string, userId: string, body: Record<string, unknown>) {
      return app.request(`/members/${userId}/work-policy`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify(body),
      });
    }

    it("assigns the named policy, reports it in GET and in GET /members, and audits the policy names", async () => {
      const { db, tenantId, userId, email, password } = await setupTestDb();
      await grantPermission(db, { tenantId, userId, permission: PERMISSION, scope: "tenant" });
      await grantPermission(db, { tenantId, userId, permission: "member.view", scope: "tenant" });
      const app = createApp({ db });
      const cookie = await loginAndGetCookie(app, email, password);
      const shortId = await createPolicy(app, cookie, { name: "固定・時短(6時間)", kind: "fixed", effectiveFrom: "2026-04-01", standardDayMinutes: 360 });

      const res = await assign(app, cookie, userId, { workPolicyId: shortId, effectiveFrom: "2026-04-15" });
      expect(res.status).toBe(201);
      expect((await res.json()).assignment).toEqual({
        workPolicyId: shortId,
        workPolicyName: "固定・時短(6時間)",
        kind: "fixed",
        effectiveFrom: "2026-04-15",
        standardDayMinutes: 360,
      });

      const getBody = await (await app.request(`/members/${userId}/work-policy`, { headers: { cookie } })).json();
      expect(getBody.effective).toMatchObject({ workPolicyId: shortId, workPolicyName: "固定・時短(6時間)", kind: "fixed", standardDayMinutes: 360 });

      const list = await (await app.request("/members", { headers: { cookie } })).json();
      const me = list.members.find((m: { id: string }) => m.id === userId);
      expect(me).toMatchObject({ workSystemKind: "fixed", workPolicyId: shortId, workPolicyName: "固定・時短(6時間)" });

      const rows = await db.select().from(auditLogs).where(eq(auditLogs.tenantId, tenantId));
      const entry = rows.find((r) => r.action === "member.work_policy.assign");
      expect(JSON.parse(entry?.afterDigest ?? "{}")).toMatchObject({
        before: "flex",
        after: "fixed",
        beforeWorkPolicyName: "Flex",
        afterWorkPolicyId: shortId,
        afterWorkPolicyName: "固定・時短(6時間)",
      });
    });

    it("rejects an unknown or other-tenant policy id (400), an archived policy (409) and a policy not yet effective on the date (409)", async () => {
      const { db, tenantId, userId, email, password } = await setupTestDb();
      await grantPermission(db, { tenantId, userId, permission: PERMISSION, scope: "tenant" });
      const app = createApp({ db });
      const cookie = await loginAndGetCookie(app, email, password);

      const unknown = await assign(app, cookie, userId, { workPolicyId: "00000000-0000-0000-0000-000000000000", effectiveFrom: "2026-05-01" });
      expect(unknown.status).toBe(400);
      expect(await unknown.json()).toEqual({ error: "invalid_work_policy_id" });

      const other = await setupTestDb();
      await grantPermission(other.db, { tenantId: other.tenantId, userId: other.userId, permission: PERMISSION, scope: "tenant" });
      const otherApp = createApp({ db: other.db });
      const otherCookie = await loginAndGetCookie(otherApp, other.email, other.password);
      const otherPolicyId = await createPolicy(otherApp, otherCookie, { name: "他社の制度", kind: "fixed", effectiveFrom: "2026-04-01", standardDayMinutes: 360 });
      const crossTenant = await assign(app, cookie, userId, { workPolicyId: otherPolicyId, effectiveFrom: "2026-05-01" });
      expect(crossTenant.status).toBe(400);
      expect(await crossTenant.json()).toEqual({ error: "invalid_work_policy_id" });

      const futureId = await createPolicy(app, cookie, { name: "6月からの制度", kind: "fixed", effectiveFrom: "2026-06-01", standardDayMinutes: 360 });
      const notYet = await assign(app, cookie, userId, { workPolicyId: futureId, effectiveFrom: "2026-05-01" });
      expect(notYet.status).toBe(409);
      expect(await notYet.json()).toEqual({ error: "work_policy_not_effective_yet" });
      // 初版の日付以降からなら割り当てられる
      expect((await assign(app, cookie, userId, { workPolicyId: futureId, effectiveFrom: "2026-06-01" })).status).toBe(201);

      const archivedId = await createPolicy(app, cookie, { name: "使わなくなった制度", kind: "fixed", effectiveFrom: "2026-04-01", standardDayMinutes: 420 });
      const patch = await app.request(`/settings/work-policies/${archivedId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ archived: true }),
      });
      expect(patch.status).toBe(200);
      const archived = await assign(app, cookie, userId, { workPolicyId: archivedId, effectiveFrom: "2026-07-01" });
      expect(archived.status).toBe(409);
      expect(await archived.json()).toEqual({ error: "work_policy_archived" });
    });

    it("does not accept kind or standardDayMinutes together with workPolicyId (400 invalid_body)", async () => {
      const { db, tenantId, userId, email, password } = await setupTestDb();
      await grantPermission(db, { tenantId, userId, permission: PERMISSION, scope: "tenant" });
      const app = createApp({ db });
      const cookie = await loginAndGetCookie(app, email, password);
      const id = await createPolicy(app, cookie, { name: "固定・時短(6時間)", kind: "fixed", effectiveFrom: "2026-04-01", standardDayMinutes: 360 });

      for (const extra of [{ standardDayMinutes: 300 }, { kind: "fixed" }]) {
        const res = await assign(app, cookie, userId, { workPolicyId: id, effectiveFrom: "2026-05-01", ...extra });
        expect(res.status).toBe(400);
        expect(await res.json()).toEqual({ error: "invalid_body" });
      }
    });

    it("legacy kind input picks the oldest non-archived policy of that kind (the default one for the kind)", async () => {
      const { db, tenantId, userId, email, password } = await setupTestDb();
      await grantPermission(db, { tenantId, userId, permission: PERMISSION, scope: "tenant" });
      const app = createApp({ db });
      const cookie = await loginAndGetCookie(app, email, password);
      const fullId = await createPolicy(app, cookie, { name: "固定(8時間)", kind: "fixed", effectiveFrom: "2000-01-01", standardDayMinutes: 480 });
      const shortId = await createPolicy(app, cookie, { name: "固定・時短(6時間)", kind: "fixed", effectiveFrom: "2000-01-01", standardDayMinutes: 360 });

      const res = await assign(app, cookie, userId, { kind: "fixed", effectiveFrom: "2026-05-01" });
      expect(res.status).toBe(201);
      expect((await res.json()).assignment).toMatchObject({ workPolicyId: fullId, workPolicyName: "固定(8時間)" });

      // 先頭の固定時間制の制度をアーカイブすると、次に古い固定時間制の制度が選ばれる
      await app.request(`/settings/work-policies/${fullId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ archived: true }),
      });
      const res2 = await assign(app, cookie, userId, { kind: "fixed", effectiveFrom: "2026-06-01" });
      expect((await res2.json()).assignment).toMatchObject({ workPolicyId: shortId });
    });

    it("legacy kind input rejects a fixed standardDayMinutes over 480", async () => {
      const { db, tenantId, userId, email, password } = await setupTestDb();
      await grantPermission(db, { tenantId, userId, permission: PERMISSION, scope: "tenant" });
      const app = createApp({ db });
      const cookie = await loginAndGetCookie(app, email, password);
      const res = await assign(app, cookie, userId, { kind: "fixed", effectiveFrom: "2026-05-01", standardDayMinutes: 540 });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid_standard_day_minutes" });
    });
  });

  describe("招待で制度を選ぶ(POST /members の workPolicyId)", () => {
    async function invite(app: ReturnType<typeof createApp>, cookie: string, body: Record<string, unknown>) {
      return app.request("/members", {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ email: "new@example.com", name: "New Member", ...body }),
      });
    }

    async function newMemberId(res: Response): Promise<string> {
      return ((await res.json()) as { member: { id: string } }).member.id;
    }

    it("assigns the chosen policy from the hire date instead of the default policy", async () => {
      const { db, tenantId, userId, email, password } = await setupTestDb();
      await grantPermission(db, { tenantId, userId, permission: PERMISSION, scope: "tenant" });
      await grantPermission(db, { tenantId, userId, permission: "member.invite", scope: "tenant" });
      const app = createApp({ db });
      const cookie = await loginAndGetCookie(app, email, password);
      const created = await app.request("/settings/work-policies", {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ name: "固定・時短(6時間)", kind: "fixed", effectiveFrom: "2000-01-01", standardDayMinutes: 360 }),
      });
      const shortId = ((await created.json()) as { policy: { id: string } }).policy.id;

      const res = await invite(app, cookie, { hireDate: "2026-04-01", workPolicyId: shortId });
      expect(res.status).toBe(201);
      const newUserId = await newMemberId(res);

      const wp = await (await app.request(`/members/${newUserId}/work-policy`, { headers: { cookie } })).json();
      expect(wp.history).toEqual([expect.objectContaining({ effectiveFrom: "2026-04-01", workPolicyId: shortId, standardDayMinutes: 360 })]);
    });

    it("falls back to the default policy when workPolicyId is omitted", async () => {
      const { db, tenantId, userId, email, password } = await setupTestDb();
      await grantPermission(db, { tenantId, userId, permission: PERMISSION, scope: "tenant" });
      await grantPermission(db, { tenantId, userId, permission: "member.invite", scope: "tenant" });
      const app = createApp({ db });
      const cookie = await loginAndGetCookie(app, email, password);

      const res = await invite(app, cookie, {});
      expect(res.status).toBe(201);
      const newUserId = await newMemberId(res);
      const wp = await (await app.request(`/members/${newUserId}/work-policy`, { headers: { cookie } })).json();
      expect(wp.history).toEqual([expect.objectContaining({ effectiveFrom: "2026-04-15", workPolicyName: "Flex" })]);
    });

    it("requires tenant_settings.flex.manage to choose a policy (403), and validates the policy (400) before creating the member", async () => {
      const { db, tenantId, userId, email, password } = await setupTestDb();
      await grantPermission(db, { tenantId, userId, permission: "member.invite", scope: "tenant" });
      const app = createApp({ db });
      const cookie = await loginAndGetCookie(app, email, password);

      const forbidden = await invite(app, cookie, { workPolicyId: "x" });
      expect(forbidden.status).toBe(403);

      await grantPermission(db, { tenantId, userId, permission: PERMISSION, scope: "tenant" });
      const cookie2 = await loginAndGetCookie(app, email, password);
      const invalid = await invite(app, cookie2, { workPolicyId: "00000000-0000-0000-0000-000000000000" });
      expect(invalid.status).toBe(400);
      expect(await invalid.json()).toEqual({ error: "invalid_work_policy_id" });

      // 検証で止めた招待ではメンバーが作られていない(同じメールアドレスで招待し直せる)
      expect((await invite(app, cookie2, {})).status).toBe(201);
    });
  });
});
