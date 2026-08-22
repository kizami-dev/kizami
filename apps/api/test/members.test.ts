import { describe, expect, it } from "vitest";
import { auditLogs, type Database } from "@kizami/db";
import { eq } from "drizzle-orm";
import { createApp } from "../src/app.js";
import { grantPermission, loginAndGetCookie, setupSecondUser, setupTestDb } from "./support/setup.js";

async function auditActionsFor(db: Database, tenantId: string): Promise<string[]> {
  const rows = await db.select().from(auditLogs).where(eq(auditLogs.tenantId, tenantId));
  return rows.map((r) => r.action);
}

interface RequestLike {
  request: (path: string, init?: RequestInit) => Promise<Response> | Response;
}

async function createDepartment(app: RequestLike, cookie: string, name: string) {
  const res = await app.request("/departments", {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ name }),
  });
  const body = (await res.json()) as { department: { id: string; name: string } };
  return body.department;
}

describe("members API", () => {
  it("GET returns 403 without member.view", async () => {
    const { db, email, password } = await setupTestDb();
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const res = await app.request("/members", { headers: { cookie } });
    expect(res.status).toBe(403);
  });

  it("GET returns the tenant's members with department and assigned preset names", async () => {
    const { db, tenantId, userId, email, password, displayName } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: "member.view", scope: "department" });
    await grantPermission(db, { tenantId, userId, permission: "member.profile.edit", scope: "department" });
    await grantPermission(db, { tenantId, userId, permission: "department.manage", scope: "tenant" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const dept = await createDepartment(app, cookie, "営業部");
    const patchRes = await app.request(`/members/${userId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ departmentId: dept.id }),
    });
    expect(patchRes.status).toBe(200);

    const res = await app.request("/members", { headers: { cookie } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      members: { id: string; name: string; email: string; isActive: boolean; department: unknown; presetNames: string[] }[];
    };
    const me = body.members.find((m) => m.id === userId);
    expect(me).toBeDefined();
    expect(me?.name).toBe(displayName);
    expect(me?.email).toBe(email);
    expect(me?.isActive).toBe(true);
    expect(me?.department).toEqual({ id: dept.id, name: "営業部" });
    // member.view / member.profile.edit / department.manage の3プリセット(test-grant helper で1件ずつ作成)を保持
    expect(me?.presetNames.length).toBe(3);
  });

  it("PATCH returns 403 without member.profile.edit", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const res = await app.request(`/members/${userId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ departmentId: tenantId }),
    });
    expect(res.status).toBe(403);
  });

  it("PATCH with an unknown departmentId returns 400 invalid_department_id", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: "member.profile.edit", scope: "department" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const res = await app.request(`/members/${userId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ departmentId: "nonexistent" }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_department_id" });
  });

  it("PATCH updates the department and records an audit log entry", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: "member.profile.edit", scope: "department" });
    await grantPermission(db, { tenantId, userId, permission: "department.manage", scope: "tenant" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const dept = await createDepartment(app, cookie, "開発部");

    const res = await app.request(`/members/${userId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ departmentId: dept.id }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ member: { id: userId, departmentId: dept.id } });

    expect(await auditActionsFor(db, tenantId)).toContain("member.update");
  });

  it("PATCH of a nonexistent member returns 404", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: "member.profile.edit", scope: "department" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const res = await app.request("/members/nonexistent", {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ departmentId: "x" }),
    });
    expect(res.status).toBe(404);
  });

  it("GET includes hireDate (null by default from setupTestDb)", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: "member.view", scope: "tenant" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const res = await app.request("/members", { headers: { cookie } });
    const body = (await res.json()) as { members: { id: string; hireDate: string | null }[] };
    const me = body.members.find((m) => m.id === userId);
    expect(me?.hireDate).toBeNull();
  });

  it("PATCH sets hireDate, GET reflects it, and an audit log entry is recorded", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: "member.profile.edit", scope: "department" });
    await grantPermission(db, { tenantId, userId, permission: "member.view", scope: "tenant" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const patchRes = await app.request(`/members/${userId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ hireDate: "2020-04-01" }),
    });
    expect(patchRes.status).toBe(200);
    expect(await patchRes.json()).toEqual({ member: { id: userId, hireDate: "2020-04-01" } });

    const res = await app.request("/members", { headers: { cookie } });
    const body = (await res.json()) as { members: { id: string; hireDate: string | null }[] };
    expect(body.members.find((m) => m.id === userId)?.hireDate).toBe("2020-04-01");

    expect(await auditActionsFor(db, tenantId)).toContain("member.update");
  });

  it("PATCH rejects a malformed hireDate with 400 invalid_hire_date", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: "member.profile.edit", scope: "department" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const res = await app.request(`/members/${userId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ hireDate: "not-a-date" }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_hire_date" });
  });

  it("PATCH with hireDate: null clears a previously set hire date", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: "member.profile.edit", scope: "department" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    await app.request(`/members/${userId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ hireDate: "2020-04-01" }),
    });
    const res = await app.request(`/members/${userId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ hireDate: null }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ member: { id: userId, hireDate: null } });
  });

  it("hireDate enables the statutory leave auto-grant that otherwise fails with hire_date_not_set", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: "member.profile.edit", scope: "department" });
    await grantPermission(db, { tenantId, userId, permission: "leave.grant.manage", scope: "tenant" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    // 法定付与の実行には有給の制度設定(GET/PUT /settings/leave)が事前に必要。
    await app.request("/settings/leave", {
      method: "PUT",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        grantMethod: "statutory",
        hourlyLeaveEnabled: false,
        hourlyLeaveMaxDays: 5,
        halfDayLeaveEnabled: true,
        stockConversionEnabled: false,
        stockMaxDays: 40,
        stockExpiresMonths: null,
      }),
    });

    const before = await app.request("/leave/grants/auto", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ userId }),
    });
    expect(before.status).toBe(400);
    expect(await before.json()).toEqual({ error: "hire_date_not_set" });

    await app.request(`/members/${userId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ hireDate: "2020-04-01" }),
    });

    const after = await app.request("/leave/grants/auto", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ userId }),
    });
    expect(after.status).toBe(201);
  });

  it("GET lists a second user with no department/presets as null/empty", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    // tenant スコープ: この検証はスコープ絞り込みの対象ではなく、無所属メンバーの
    // department/presetNames のシリアライズ(null/[]になること)を見たいだけのため、
    // department スコープ(かつ actor 自身も無所属)だと apps/api/src/lib/scope.ts の
    // 「無所属なら本人のみ」規則により second user がそもそも見えなくなってしまう。
    await grantPermission(db, { tenantId, userId, permission: "member.view", scope: "tenant" });
    const second = await setupSecondUser(db, tenantId);
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const res = await app.request("/members", { headers: { cookie } });
    const body = (await res.json()) as { members: { id: string; department: unknown; presetNames: string[] }[] };
    const other = body.members.find((m) => m.id === second.userId);
    expect(other).toEqual({
      id: second.userId,
      name: "Second User",
      email: second.email,
      isActive: true,
      hireDate: null,
      department: null,
      presetNames: [],
    });
  });
});
