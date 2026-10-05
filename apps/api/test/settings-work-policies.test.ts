import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { auditLogs, type Database } from "@kizami/db";
import { createApp } from "../src/app.js";
import { grantPermission, loginAndGetCookie, setupExtraUser, setupSecondUser, setupTestDb } from "./support/setup.js";

const PERMISSION = "tenant_settings.flex.manage";

const FIXED_NOW = new Date("2026-04-15T03:00:00.000Z"); // JST 2026-04-15 12:00

interface RequestLike {
  request: (path: string, init?: RequestInit) => Promise<Response> | Response;
}

function send(app: RequestLike, cookie: string, method: string, path: string, body: unknown): Promise<Response> {
  return Promise.resolve(app.request(path, { method, headers: { "content-type": "application/json", cookie }, body: JSON.stringify(body) }));
}

async function auditEntries(db: Database, tenantId: string, action: string) {
  const rows = await db.select().from(auditLogs).where(eq(auditLogs.tenantId, tenantId));
  return rows.filter((r) => r.action === action).map((r) => JSON.parse(r.afterDigest ?? "{}") as Record<string, unknown>);
}

async function setupAdmin() {
  const seeded = await setupTestDb();
  await grantPermission(seeded.db, { tenantId: seeded.tenantId, userId: seeded.userId, permission: PERMISSION, scope: "tenant" });
  const app = createApp({ db: seeded.db });
  const cookie = await loginAndGetCookie(app, seeded.email, seeded.password);
  return { ...seeded, app, cookie };
}

const SHORT_POLICY = { name: "固定・時短(6時間)", kind: "fixed", effectiveFrom: "2026-04-01", standardDayMinutes: 360 };

describe("/settings/work-policies(名前付きの労働時間制の制度)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("requires tenant_settings.flex.manage for every endpoint (403)", async () => {
    const { db, email, password } = await setupTestDb();
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    expect((await app.request("/settings/work-policies", { headers: { cookie } })).status).toBe(403);
    expect((await send(app, cookie, "POST", "/settings/work-policies", SHORT_POLICY)).status).toBe(403);
    expect((await send(app, cookie, "PATCH", "/settings/work-policies/x", { name: "a" })).status).toBe(403);
    expect((await send(app, cookie, "POST", "/settings/work-policies/x/versions", { effectiveFrom: "2026-05-01" })).status).toBe(403);
  });

  it("GET lists the seeded policy as the default, with its effective version, history and assignee count", async () => {
    const { app, cookie } = await setupAdmin();

    const res = await app.request("/settings/work-policies", { headers: { cookie } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.policies).toHaveLength(1);
    const [policy] = body.policies;
    expect(body.defaultWorkPolicyId).toBe(policy.id);
    expect(policy).toMatchObject({ name: "Flex", kind: "flex", isDefault: true, archivedAt: null, assigneeCount: 1 });
    expect(policy.effective).toMatchObject({ effectiveFrom: "1970-01-01", kind: "flex", standardDayMinutes: 480 });
    expect(policy.history).toHaveLength(1);
  });

  it("POST creates a named fixed policy with its initial version, records work_policy.create, and lists it as non-default", async () => {
    const { db, tenantId, app, cookie } = await setupAdmin();

    const res = await send(app, cookie, "POST", "/settings/work-policies", { ...SHORT_POLICY, name: "  固定・時短(6時間) " });
    expect(res.status).toBe(201);
    const created = (await res.json()).policy;
    expect(created).toMatchObject({ name: "固定・時短(6時間)", kind: "fixed", isDefault: false, assigneeCount: 0 });
    expect(created.history).toEqual([expect.objectContaining({ effectiveFrom: "2026-04-01", kind: "fixed", standardDayMinutes: 360, core: null })]);

    const entries = await auditEntries(db, tenantId, "work_policy.create");
    expect(entries).toEqual([expect.objectContaining({ name: "固定・時短(6時間)" })]);

    const list = await (await app.request("/settings/work-policies", { headers: { cookie } })).json();
    expect(list.policies.map((p: { name: string; isDefault: boolean }) => [p.name, p.isDefault])).toEqual([
      ["Flex", true],
      ["固定・時短(6時間)", false],
    ]);
  });

  it("POST accepts a past effectiveFrom for the initial version (nobody is assigned yet, so no past figure changes)", async () => {
    const { app, cookie } = await setupAdmin();
    const res = await send(app, cookie, "POST", "/settings/work-policies", { ...SHORT_POLICY, effectiveFrom: "2000-01-01" });
    expect(res.status).toBe(201);
    expect((await res.json()).policy.effective).toMatchObject({ effectiveFrom: "2000-01-01", standardDayMinutes: 360 });
  });

  it("POST rejects a fixed standardDayMinutes outside 1..480 with 400 invalid_standard_day_minutes", async () => {
    const { app, cookie } = await setupAdmin();
    for (const standardDayMinutes of [0, 481, 540, 1.5, "360"]) {
      const res = await send(app, cookie, "POST", "/settings/work-policies", { ...SHORT_POLICY, standardDayMinutes });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid_standard_day_minutes" });
    }
    // 境界: 1分と480分は通る
    expect((await send(app, cookie, "POST", "/settings/work-policies", { ...SHORT_POLICY, name: "1分", standardDayMinutes: 1 })).status).toBe(201);
    expect((await send(app, cookie, "POST", "/settings/work-policies", { ...SHORT_POLICY, name: "8時間", standardDayMinutes: 480 })).status).toBe(201);
  });

  it("POST still allows a flex standard day over 8 hours (the 480 cap is for fixed only)", async () => {
    const { app, cookie } = await setupAdmin();
    const res = await send(app, cookie, "POST", "/settings/work-policies", {
      name: "フレックス(9時間)",
      kind: "flex",
      settlementPeriod: "monthly",
      effectiveFrom: "2026-04-01",
      standardDayMinutes: 540,
    });
    expect(res.status).toBe(201);
  });

  it("POST rejects a duplicate name in the same tenant with 409 work_policy_name_taken, and a blank or too long name with 400 invalid_name", async () => {
    const { app, cookie } = await setupAdmin();
    expect((await send(app, cookie, "POST", "/settings/work-policies", SHORT_POLICY)).status).toBe(201);

    const dup = await send(app, cookie, "POST", "/settings/work-policies", { ...SHORT_POLICY, name: " 固定・時短(6時間)" });
    expect(dup.status).toBe(409);
    expect(await dup.json()).toEqual({ error: "work_policy_name_taken" });

    // 既存のシードの制度名とも衝突する
    const dupSeed = await send(app, cookie, "POST", "/settings/work-policies", { ...SHORT_POLICY, name: "Flex" });
    expect(dupSeed.status).toBe(409);

    for (const name of ["", "   ", "あ".repeat(101), 1]) {
      const res = await send(app, cookie, "POST", "/settings/work-policies", { ...SHORT_POLICY, name });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid_name" });
    }
  });

  it("the same name is allowed in another tenant", async () => {
    const a = await setupAdmin();
    const b = await setupAdmin();
    expect((await send(a.app, a.cookie, "POST", "/settings/work-policies", SHORT_POLICY)).status).toBe(201);
    expect((await send(b.app, b.cookie, "POST", "/settings/work-policies", SHORT_POLICY)).status).toBe(201);
  });

  it("PATCH renames (audited as work_policy.rename), rejects a taken name, and 404s for another tenant's policy", async () => {
    const { db, tenantId, app, cookie } = await setupAdmin();
    const created = (await (await send(app, cookie, "POST", "/settings/work-policies", SHORT_POLICY)).json()).policy;

    const taken = await send(app, cookie, "PATCH", `/settings/work-policies/${created.id}`, { name: "Flex" });
    expect(taken.status).toBe(409);
    expect(await taken.json()).toEqual({ error: "work_policy_name_taken" });

    const res = await send(app, cookie, "PATCH", `/settings/work-policies/${created.id}`, { name: "育児短時間(6時間)" });
    expect(res.status).toBe(200);
    expect((await res.json()).policy).toMatchObject({ id: created.id, name: "育児短時間(6時間)" });
    expect(await auditEntries(db, tenantId, "work_policy.rename")).toEqual([{ before: "固定・時短(6時間)", after: "育児短時間(6時間)" }]);

    // 同じ名前への変更は何もしない(監査ログも増えない)
    expect((await send(app, cookie, "PATCH", `/settings/work-policies/${created.id}`, { name: "育児短時間(6時間)" })).status).toBe(200);
    expect(await auditEntries(db, tenantId, "work_policy.rename")).toHaveLength(1);

    const other = await setupAdmin();
    const res404 = await send(other.app, other.cookie, "PATCH", `/settings/work-policies/${created.id}`, { name: "x" });
    expect(res404.status).toBe(404);
  });

  it("PATCH archives a non-default policy (and back), but refuses to archive the default policy", async () => {
    const { db, tenantId, app, cookie } = await setupAdmin();
    const list = await (await app.request("/settings/work-policies", { headers: { cookie } })).json();
    const defaultId = list.defaultWorkPolicyId as string;

    const refuse = await send(app, cookie, "PATCH", `/settings/work-policies/${defaultId}`, { archived: true });
    expect(refuse.status).toBe(409);
    expect(await refuse.json()).toEqual({ error: "cannot_archive_default_work_policy" });

    const created = (await (await send(app, cookie, "POST", "/settings/work-policies", SHORT_POLICY)).json()).policy;
    const archive = await send(app, cookie, "PATCH", `/settings/work-policies/${created.id}`, { archived: true });
    expect(archive.status).toBe(200);
    expect((await archive.json()).policy.archivedAt).not.toBeNull();

    const unarchive = await send(app, cookie, "PATCH", `/settings/work-policies/${created.id}`, { archived: false });
    expect((await unarchive.json()).policy.archivedAt).toBeNull();

    expect(await auditEntries(db, tenantId, "work_policy.archive")).toHaveLength(1);
    expect(await auditEntries(db, tenantId, "work_policy.unarchive")).toHaveLength(1);

    expect((await send(app, cookie, "PATCH", `/settings/work-policies/${created.id}`, {})).status).toBe(400);
    expect((await send(app, cookie, "PATCH", `/settings/work-policies/${created.id}`, { archived: "yes" })).status).toBe(400);
  });

  it("POST /:id/versions appends a version with the same rules as POST /settings/work-policy, and audits the policy it belongs to", async () => {
    const { db, tenantId, app, cookie } = await setupAdmin();
    const created = (await (await send(app, cookie, "POST", "/settings/work-policies", SHORT_POLICY)).json()).policy;
    const path = `/settings/work-policies/${created.id}/versions`;

    const past = await send(app, cookie, "POST", path, { effectiveFrom: "2026-04-14", kind: "fixed", standardDayMinutes: 300 });
    expect(past.status).toBe(409);
    expect(await past.json()).toEqual({ error: "effective_from_in_past" });

    const tooLong = await send(app, cookie, "POST", path, { effectiveFrom: "2026-05-01", kind: "fixed", standardDayMinutes: 481 });
    expect(tooLong.status).toBe(400);
    expect(await tooLong.json()).toEqual({ error: "invalid_standard_day_minutes" });

    const ok = await send(app, cookie, "POST", path, { effectiveFrom: "2026-05-01", kind: "fixed", standardDayMinutes: 300 });
    expect(ok.status).toBe(201);

    const dup = await send(app, cookie, "POST", path, { effectiveFrom: "2026-05-01", kind: "fixed", standardDayMinutes: 330 });
    expect(dup.status).toBe(409);
    expect(await dup.json()).toEqual({ error: "version_already_exists" });

    const entries = await auditEntries(db, tenantId, "work_policy_version.create");
    expect(entries).toEqual([
      expect.objectContaining({
        workPolicyId: created.id,
        workPolicyName: "固定・時短(6時間)",
        before: expect.objectContaining({ standardDayMinutes: 360 }),
        after: expect.objectContaining({ effectiveFrom: "2026-05-01", standardDayMinutes: 300 }),
      }),
    ]);

    // 今日(4/15)時点の実効値は初版のまま、履歴は2件
    const list = await (await app.request("/settings/work-policies", { headers: { cookie } })).json();
    const policy = list.policies.find((p: { id: string }) => p.id === created.id);
    expect(policy.effective.standardDayMinutes).toBe(360);
    expect(policy.history.map((v: { standardDayMinutes: number }) => v.standardDayMinutes)).toEqual([360, 300]);

    expect((await send(app, cookie, "POST", "/settings/work-policies/nope/versions", { effectiveFrom: "2026-05-01" })).status).toBe(404);
  });

  it("the legacy POST /settings/work-policy also rejects a fixed standardDayMinutes over 480", async () => {
    const { app, cookie } = await setupAdmin();
    const res = await send(app, cookie, "POST", "/settings/work-policy", { effectiveFrom: "2026-05-01", kind: "fixed", standardDayMinutes: 540 });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_standard_day_minutes" });
  });

  it("assigneeCount counts members assigned as of today, not those whose assignment starts later", async () => {
    const { db, tenantId, app, cookie } = await setupAdmin();
    const created = (await (await send(app, cookie, "POST", "/settings/work-policies", SHORT_POLICY)).json()).policy;
    const second = await setupSecondUser(db, tenantId);
    const third = await setupExtraUser(db, { tenantId, email: "third@example.com", name: "Third User" });

    // 今日から時短 → 数える。もう1人は来月から → まだ数えない(今日時点で割当が無い)。
    expect((await send(app, cookie, "POST", `/members/${second.userId}/work-policy`, { workPolicyId: created.id, effectiveFrom: "2026-04-15" })).status).toBe(201);
    expect((await send(app, cookie, "POST", `/members/${third.userId}/work-policy`, { workPolicyId: created.id, effectiveFrom: "2026-05-01" })).status).toBe(201);
    const list = await (await app.request("/settings/work-policies", { headers: { cookie } })).json();
    const counts = Object.fromEntries(list.policies.map((p: { name: string; assigneeCount: number }) => [p.name, p.assigneeCount]));
    expect(counts).toEqual({ Flex: 1, "固定・時短(6時間)": 1 });
  });
});
