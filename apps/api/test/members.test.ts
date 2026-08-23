import { describe, expect, it } from "vitest";
import { auditLogs, tenants, users, uuidv7, type Database } from "@kizami/db";
import { eq } from "drizzle-orm";
import { createApp } from "../src/app.js";
import { grantPermission, loginAndGetCookie, setupSecondUser, setupTestDb } from "./support/setup.js";
import { buildSettingsTimeline } from "../src/lib/settings.js";

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
      // setupSecondUser は auth_credentials も作るため受諾済み(active)扱いになる
      inviteStatus: "active",
    });
  });
});

interface InviteMemberResponse {
  member: { id: string; name: string; email: string; hireDate: string | null; department: unknown };
  invitation: { id: string; token: string; expiresAt: number };
}

async function inviteMember(
  app: RequestLike,
  cookie: string,
  body: { email: string; name: string; departmentId?: string; hireDate?: string; presetIds?: string[] },
): Promise<{ status: number; json: InviteMemberResponse }> {
  const res = await app.request("/members", {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as InviteMemberResponse };
}

describe("POST /members (invitation-based creation, 2026-08-23)", () => {
  it("returns 403 without member.invite", async () => {
    const { db, email, password } = await setupTestDb();
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const res = await app.request("/members", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ email: "new@example.com", name: "New Member" }),
    });
    expect(res.status).toBe(403);
  });

  it("creates a users row (no auth_credentials yet), issues a one-time invitation token, and records an audit log", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: "member.invite", scope: "tenant" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const invited = await inviteMember(app, cookie, { email: "new@example.com", name: "New Member" });
    expect(invited.status).toBe(201);
    expect(invited.json.member.email).toBe("new@example.com");
    expect(invited.json.member.name).toBe("New Member");
    expect(typeof invited.json.invitation.token).toBe("string");
    expect(invited.json.invitation.token.length).toBeGreaterThan(0);

    expect(await auditActionsFor(db, tenantId)).toContain("member.invite");

    // 受諾前はログイン不可(credential が無い)。
    const loginRes = await app.request("/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "new@example.com", password: "irrelevant but long enough" }),
    });
    expect(loginRes.status).toBe(401);
  });

  it("rejects a duplicate email within the same tenant with 409", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: "member.invite", scope: "tenant" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const first = await inviteMember(app, cookie, { email: "dup@example.com", name: "First" });
    expect(first.status).toBe(201);

    const second = await inviteMember(app, cookie, { email: "dup@example.com", name: "Second" });
    expect(second.status).toBe(409);
    expect(second.json).toEqual({ error: "email_already_exists" });
  });

  it("allows the same email to be invited when it already exists in a different tenant", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: "member.invite", scope: "tenant" });

    const otherTenantId = uuidv7();
    await db.insert(tenants).values({ id: otherTenantId, name: "Other Tenant", createdAt: 0 });
    await db.insert(users).values({
      id: uuidv7(),
      tenantId: otherTenantId,
      email: "shared@example.com",
      name: "Elsewhere",
      isActive: true,
      createdAt: 0,
    });

    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const invited = await inviteMember(app, cookie, { email: "shared@example.com", name: "New Member" });
    expect(invited.status).toBe(201);
  });

  it("rejects a departmentId outside the actor's scope with 403", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: "member.invite", scope: "department" });
    await grantPermission(db, { tenantId, userId, permission: "department.manage", scope: "tenant" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    // actor は無所属のまま、部署だけ作る(actor 自身の所属部署ではないため department スコープ外)。
    const dept = await createDepartment(app, cookie, "営業部");

    const res = await app.request("/members", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ email: "new@example.com", name: "New Member", departmentId: dept.id }),
    });
    expect(res.status).toBe(403);
  });

  // レビュー指摘F2: departmentId を省略すると、以前はスコープ絞り込みが丸ごとスキップされ、
  // department スコープの招待者でもテナント全体に対して自由に(部署未設定の)メンバーを
  // 作成できてしまっていた。actor のスコープが tenant でない限り、departmentId 省略は
  // 400 department_id_required で拒否する。
  // レビュー指摘2(トランザクション化): createUser・upsertMembership・招待作成・監査ログ追記が
  // 1つの db.transaction にまとまったことを、部署付きの作成が実際にコミットされる(GET
  // /members で部署が見える)ことで確認する。
  it("commits the membership created inside the transaction (department is visible afterwards)", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: "member.invite", scope: "tenant" });
    await grantPermission(db, { tenantId, userId, permission: "member.view", scope: "tenant" });
    await grantPermission(db, { tenantId, userId, permission: "department.manage", scope: "tenant" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const dept = await createDepartment(app, cookie, "営業部");
    const invited = await inviteMember(app, cookie, { email: "new@example.com", name: "New Member", departmentId: dept.id });
    expect(invited.status).toBe(201);
    expect(invited.json.member.department).toEqual({ id: dept.id });

    const listRes = await app.request("/members", { headers: { cookie } });
    const listBody = (await listRes.json()) as { members: Array<{ email: string; department: { id: string; name: string } | null }> };
    const created = listBody.members.find((m) => m.email === "new@example.com");
    expect(created?.department).toEqual({ id: dept.id, name: "営業部" });
  });

  it("rejects an omitted departmentId with 400 when the actor's member.invite scope is not tenant", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: "member.invite", scope: "department" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const res = await inviteMember(app, cookie, { email: "new@example.com", name: "New Member" });
    expect(res.status).toBe(400);
    expect(res.json).toEqual({ error: "department_id_required" });
  });

  it("allows an omitted departmentId when the actor's member.invite scope is tenant", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: "member.invite", scope: "tenant" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const res = await inviteMember(app, cookie, { email: "new@example.com", name: "New Member" });
    expect(res.status).toBe(201);
    expect(res.json.member.department).toBeNull();
  });

  it("assigns presetIds when the actor also holds permission.assignment.manage", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: "member.invite", scope: "tenant" });
    await grantPermission(db, { tenantId, userId, permission: "member.view", scope: "tenant" });
    await grantPermission(db, { tenantId, userId, permission: "permission.assignment.manage", scope: "tenant" });
    await grantPermission(db, { tenantId, userId, permission: "permission.preset.manage", scope: "tenant" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const presetRes = await app.request("/presets", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ name: "閲覧のみ", grants: [{ key: "member.view", scope: "department" }] }),
    });
    const preset = (await presetRes.json()) as { preset: { id: string } };

    const invited = await inviteMember(app, cookie, {
      email: "new@example.com",
      name: "New Member",
      presetIds: [preset.preset.id],
    });
    expect(invited.status).toBe(201);

    const membersRes = await app.request("/members", { headers: { cookie } });
    const membersBody = (await membersRes.json()) as { members: { id: string; presetNames: string[] }[] };
    expect(membersBody.members.find((m) => m.id === invited.json.member.id)?.presetNames).toEqual(["閲覧のみ"]);
  });

  it("rejects presetIds when the actor lacks permission.assignment.manage with 403", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: "member.invite", scope: "tenant" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const res = await app.request("/members", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ email: "new@example.com", name: "New Member", presetIds: ["nonexistent"] }),
    });
    expect(res.status).toBe(403);
  });
});

describe("POST /members/:id/invitations, DELETE /members/:id/invitations (2026-08-23)", () => {
  it("reissuing an invitation revokes the previous one", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: "member.invite", scope: "tenant" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const invited = await inviteMember(app, cookie, { email: "new@example.com", name: "New Member" });
    const targetId = invited.json.member.id;

    const reissueRes = await app.request(`/members/${targetId}/invitations`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
    });
    expect(reissueRes.status).toBe(201);
    const reissueBody = (await reissueRes.json()) as { invitation: { token: string } };
    expect(reissueBody.invitation.token).not.toBe(invited.json.invitation.token);

    expect(await auditActionsFor(db, tenantId)).toContain("member.invite.reissue");
  });

  it("reissuing for an already-accepted (active) member returns 409", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: "member.invite", scope: "tenant" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const invited = await inviteMember(app, cookie, { email: "new@example.com", name: "New Member" });
    const token = invited.json.invitation.token;
    const targetId = invited.json.member.id;

    const acceptRes = await app.request(`/invitations/${token}/accept`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: "correct horse battery staple 2" }),
    });
    expect(acceptRes.status).toBe(200);

    const reissueRes = await app.request(`/members/${targetId}/invitations`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
    });
    expect(reissueRes.status).toBe(409);
    expect(await reissueRes.json()).toEqual({ error: "already_active" });
  });

  it("reissuing for a nonexistent member returns 404", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: "member.invite", scope: "tenant" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const res = await app.request("/members/nonexistent/invitations", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
    });
    expect(res.status).toBe(404);
  });

  it("revoking twice returns 409 already_revoked the second time", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: "member.invite", scope: "tenant" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const invited = await inviteMember(app, cookie, { email: "new@example.com", name: "New Member" });
    const targetId = invited.json.member.id;

    const firstRevoke = await app.request(`/members/${targetId}/invitations`, { method: "DELETE", headers: { cookie } });
    expect(firstRevoke.status).toBe(200);
    expect(await auditActionsFor(db, tenantId)).toContain("member.invite.revoke");

    const secondRevoke = await app.request(`/members/${targetId}/invitations`, { method: "DELETE", headers: { cookie } });
    expect(secondRevoke.status).toBe(409);
    expect(await secondRevoke.json()).toEqual({ error: "already_revoked" });
  });

  it("without member.invite, both reissue and revoke return 403", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: "member.invite", scope: "tenant" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);
    const invited = await inviteMember(app, cookie, { email: "new@example.com", name: "New Member" });
    const targetId = invited.json.member.id;

    // 別ユーザー(member.invite を持たない、二人目の自テナントユーザー)で試す。
    const second = await setupSecondUser(db, tenantId);
    const secondCookie = await loginAndGetCookie(app, second.email, second.password);

    const reissueRes = await app.request(`/members/${targetId}/invitations`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: secondCookie },
    });
    expect(reissueRes.status).toBe(403);

    const revokeRes = await app.request(`/members/${targetId}/invitations`, { method: "DELETE", headers: { cookie: secondCookie } });
    expect(revokeRes.status).toBe(403);
  });
});

describe("POST /members: 労働時間制の自動割当(2026-08-23)", () => {
  it("招待で作られたメンバーにテナント既定の work policy が割り当てられ、月次集計が解決できる", async () => {
    const seeded = await setupTestDb();
    await grantPermission(seeded.db, {
      tenantId: seeded.tenantId,
      userId: seeded.userId,
      permission: "member.invite",
      scope: "tenant",
    });
    const app = createApp({ db: seeded.db });
    const cookie = await loginAndGetCookie(app, seeded.email, seeded.password);

    const res = await app.request("/members", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ email: "policy-check@example.com", name: "制度 割当", hireDate: "2026-04-01" }),
    });
    expect(res.status).toBe(201);
    const created = (await res.json()) as { member: { id: string } };

    // 制度未割当だと buildSettingsTimeline が「no work policy assigned」で例外になる。
    // 割当済みなら入社日以降の期間でタイムラインが解決できる。
    const timeline = await buildSettingsTimeline(seeded.db, {
      tenantId: seeded.tenantId,
      userId: created.member.id,
      fromDate: "2026-05-01",
      toDate: "2026-05-31",
    });
    expect(timeline.length).toBeGreaterThan(0);
    expect(timeline[0]?.settings.workSystem.kind).toBe("flex");
  });
});
