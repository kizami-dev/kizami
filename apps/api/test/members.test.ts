import { describe, expect, it } from "vitest";
import {
  auditLogs,
  getUserById,
  listAssignedPresetGrants,
  permissionPresets,
  presetAssignments,
  tenants,
  upsertMembership,
  users,
  uuidv7,
  type Database,
} from "@kizami/db";
import { eq } from "drizzle-orm";
import { createApp } from "../src/app.js";
import { grantPermission, loginAndGetCookie, setupExtraUser, setupSecondUser, setupTestDb, loginAsHrEditor } from "./support/setup.js";
import { buildSettingsTimeline } from "../src/lib/settings.js";
import { ADMIN_GRANTS } from "../src/lib/tenant-bootstrap.js";

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
    await grantPermission(db, { tenantId, userId, permission: "member.profile.edit", scope: "tenant" });
    await grantPermission(db, { tenantId, userId, permission: "department.manage", scope: "tenant" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);
    const hrCookie = await loginAsHrEditor(app, db, { tenantId, fromUserId: userId });

    const dept = await createDepartment(app, cookie, "営業部");
    const patchRes = await app.request(`/members/${userId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie: hrCookie },
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
    await grantPermission(db, { tenantId, userId, permission: "member.profile.edit", scope: "tenant" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);
    const hrCookie = await loginAsHrEditor(app, db, { tenantId, fromUserId: userId });

    const res = await app.request(`/members/${userId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie: hrCookie },
      body: JSON.stringify({ departmentId: "nonexistent" }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_department_id" });
  });

  it("PATCH updates the department and records an audit log entry", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: "member.profile.edit", scope: "tenant" });
    await grantPermission(db, { tenantId, userId, permission: "department.manage", scope: "tenant" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);
    const hrCookie = await loginAsHrEditor(app, db, { tenantId, fromUserId: userId });

    const dept = await createDepartment(app, cookie, "開発部");

    const res = await app.request(`/members/${userId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie: hrCookie },
      body: JSON.stringify({ departmentId: dept.id }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ member: { id: userId, departmentId: dept.id } });

    expect(await auditActionsFor(db, tenantId)).toContain("member.update");
  });

  // セキュリティ: 部署スコープの編集者が自分(=編集対象に必ず含まれる)を親部署へ移すことを
  // 繰り返すと、ルート部署まで上がって部署スコープの全権限を全社に広げられた。
  it("PATCH rejects moving a member (including oneself) to a department outside the actor's scope", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: "department.manage", scope: "tenant" });
    const app = createApp({ db });
    const adminCookie = await loginAndGetCookie(app, email, password);
    const createChild = async (name: string, parentId: string) => {
      const res = await app.request("/departments", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: adminCookie },
        body: JSON.stringify({ name, parentId }),
      });
      return ((await res.json()) as { department: { id: string } }).department;
    };
    const root = await createDepartment(app, adminCookie, "本社");
    const child = await createChild("営業部", root.id);
    const grandchild = await createChild("営業一課", child.id);

    // 営業部のマネージャー(標準プリセットと同じ department_and_descendants)と、その部下
    const manager = await setupSecondUser(db, tenantId);
    await upsertMembership(db, { tenantId, userId: manager.userId, departmentId: child.id, createdAt: 0 });
    await grantPermission(db, {
      tenantId,
      userId: manager.userId,
      permission: "member.profile.edit",
      scope: "department_and_descendants",
    });
    const report = await setupExtraUser(db, { tenantId, email: "report@example.com", name: "部下" });
    await upsertMembership(db, { tenantId, userId: report.userId, departmentId: child.id, createdAt: 0 });
    const managerCookie = await loginAndGetCookie(app, manager.email, manager.password);

    const patch = (targetId: string, departmentId: string) =>
      app.request(`/members/${targetId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", cookie: managerCookie },
        body: JSON.stringify({ departmentId }),
      });

    // 自分を親部署へ: 403(以前は 200 で、以後の管轄が本社配下=全社に広がった)
    expect((await patch(manager.userId, root.id)).status).toBe(403);
    // 部下を管轄外(親部署)へ: 403
    expect((await patch(report.userId, root.id)).status).toBe(403);
    // 部下を管轄内(配下部署)へ: 200
    expect((await patch(report.userId, grandchild.id)).status).toBe(200);
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
    await grantPermission(db, { tenantId, userId, permission: "member.profile.edit", scope: "tenant" });
    await grantPermission(db, { tenantId, userId, permission: "member.view", scope: "tenant" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);
    const hrCookie = await loginAsHrEditor(app, db, { tenantId, fromUserId: userId });

    const patchRes = await app.request(`/members/${userId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie: hrCookie },
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
    await grantPermission(db, { tenantId, userId, permission: "member.profile.edit", scope: "tenant" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);
    const hrCookie = await loginAsHrEditor(app, db, { tenantId, fromUserId: userId });

    const res = await app.request(`/members/${userId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie: hrCookie },
      body: JSON.stringify({ hireDate: "not-a-date" }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_hire_date" });
  });

  it("PATCH with hireDate: null clears a previously set hire date", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: "member.profile.edit", scope: "tenant" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);
    const hrCookie = await loginAsHrEditor(app, db, { tenantId, fromUserId: userId });

    await app.request(`/members/${userId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie: hrCookie },
      body: JSON.stringify({ hireDate: "2020-04-01" }),
    });
    const res = await app.request(`/members/${userId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie: hrCookie },
      body: JSON.stringify({ hireDate: null }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ member: { id: userId, hireDate: null } });
  });

  /**
   * 有給付与の区分(比例付与、労基法39条3項・労基法施行規則24条の3、2026-08-24 追加)。
   * hireDate と同じ member.profile.edit で編集し、監査ログに変更前後を残す。
   */
  it("GET returns leaveGrantClass 'full' by default and PATCH updates it with an audit entry", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: "member.profile.edit", scope: "tenant" });
    await grantPermission(db, { tenantId, userId, permission: "member.view", scope: "tenant" });
    await grantPermission(db, { tenantId, userId, permission: "audit_log.view", scope: "tenant" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);
    const hrCookie = await loginAsHrEditor(app, db, { tenantId, fromUserId: userId });

    const before = await app.request("/members", { headers: { cookie } });
    const beforeBody = (await before.json()) as { members: { id: string; leaveGrantClass: string }[] };
    expect(beforeBody.members.find((m) => m.id === userId)?.leaveGrantClass).toBe("full");

    const patchRes = await app.request(`/members/${userId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie: hrCookie },
      body: JSON.stringify({ leaveGrantClass: "days4" }),
    });
    expect(patchRes.status).toBe(200);
    expect(await patchRes.json()).toEqual({ member: { id: userId, leaveGrantClass: "days4" } });

    const after = await app.request("/members", { headers: { cookie } });
    const afterBody = (await after.json()) as { members: { id: string; leaveGrantClass: string }[] };
    expect(afterBody.members.find((m) => m.id === userId)?.leaveGrantClass).toBe("days4");

    expect(await auditActionsFor(db, tenantId)).toContain("member.update");
    // 監査ログには変更前後の両方を残す(日数の根拠を後から追えるようにするため)。
    const details = (await db.select().from(auditLogs).where(eq(auditLogs.tenantId, tenantId)))
      .filter((r) => r.action === "member.update")
      .map((r) => JSON.parse(r.afterDigest ?? "{}") as Record<string, unknown>);
    expect(details.some((d) => d.leaveGrantClass === "days4" && d.leaveGrantClassFrom === "full")).toBe(true);
  });

  it("PATCH rejects an unknown leaveGrantClass with 400 invalid_leave_grant_class", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: "member.profile.edit", scope: "tenant" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);
    const hrCookie = await loginAsHrEditor(app, db, { tenantId, fromUserId: userId });

    for (const value of ["days5", "", null, 4]) {
      const res = await app.request(`/members/${userId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", cookie: hrCookie },
        body: JSON.stringify({ leaveGrantClass: value }),
      });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid_leave_grant_class" });
    }
  });

  it("PATCH requires member.profile.edit for leaveGrantClass too (403 without it)", async () => {
    const { db, userId, email, password } = await setupTestDb();
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const res = await app.request(`/members/${userId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ leaveGrantClass: "days3" }),
    });
    expect(res.status).toBe(403);
  });

  it("hireDate enables the statutory leave auto-grant that otherwise fails with hire_date_not_set", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: "member.profile.edit", scope: "tenant" });
    await grantPermission(db, { tenantId, userId, permission: "leave.grant.manage", scope: "tenant" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);
    const hrCookie = await loginAsHrEditor(app, db, { tenantId, fromUserId: userId });

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
      headers: { "content-type": "application/json", cookie: hrCookie },
      body: JSON.stringify({ userId }),
    });
    expect(before.status).toBe(400);
    expect(await before.json()).toEqual({ error: "hire_date_not_set" });

    await app.request(`/members/${userId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie: hrCookie },
      body: JSON.stringify({ hireDate: "2020-04-01" }),
    });

    const after = await app.request("/leave/grants/auto", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: hrCookie },
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
      // 退職者データのライフサイクル(2026-08-27 追加、docs/design/data-retention.md)。
      // 在籍中なので未消去・退職日なし = 消去不可。
      erasedAt: null,
      retention: { deactivatedDate: null, erasableFrom: null, erasable: false, remainingDays: null },
      hireDate: null,
      // 有給付与の区分(2026-08-24 追加)。DB の DEFAULT が 'full'。
      leaveGrantClass: "full",
      department: null,
      presetNames: [],
      // setupSecondUser は auth_credentials も作るため受諾済み(active)扱いになる
      inviteStatus: "active",
      // パスワードリセット(Tier 0)を一度も発行していないので false。
      hasPendingPasswordReset: false,
      // setupSecondUser は work_policy 割当を行わないため未割当(null)。
      workSystemKind: null,
      // 割当先の制度(2026-10-05、名前付きの制度)。未割当なので null。
      workPolicyId: null,
      workPolicyName: null,
      // 二要素認証(2026-08-27 追加)。有効化していないので false。
      twoFactorEnabled: false,
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

// セキュリティ(H3、2026-10-22): 部署スコープの管理権限で、同じ部署にいる自分より上の人
// (管理者)を操作できた。リセットトークンを発行して管理者アカウントを乗っ取る、2FA を外して
// 無効化する、部下に「管理者」プリセットを付けて昇格させる、などが通っていた。
describe("members API — 自分より上の人は操作できない(H3)", () => {
  /** 同梱の「管理者」プリセット(全権限・テナント全体)を作り、指定ユーザーへ割り当てる。 */
  async function createAdminPreset(db: Database, tenantId: string): Promise<string> {
    const presetId = uuidv7();
    await db.insert(permissionPresets).values({
      id: presetId,
      tenantId,
      name: "管理者",
      grants: JSON.stringify(ADMIN_GRANTS),
      isSystem: true,
      createdAt: 0,
    });
    return presetId;
  }
  async function assignPreset(db: Database, params: { tenantId: string; userId: string; presetId: string }) {
    await db.insert(presetAssignments).values({ id: uuidv7(), ...params, createdAt: 0 });
  }

  /**
   * テナント管理者(seeded のユーザー)・営業部の担当者(部署スコープの招待・無効化・割当権限)・
   * 同じ営業部に所属する別の管理者・同じ営業部の一般メンバーを用意する。
   */
  async function scenario() {
    const seeded = await setupTestDb();
    const { db, tenantId } = seeded;
    const adminPresetId = await createAdminPreset(db, tenantId);
    await assignPreset(db, { tenantId, userId: seeded.userId, presetId: adminPresetId });
    const app = createApp({ db });
    const adminCookie = await loginAndGetCookie(app, seeded.email, seeded.password);
    const sales = await createDepartment(app, adminCookie, "営業部");

    const manager = await setupSecondUser(db, tenantId);
    await upsertMembership(db, { tenantId, userId: manager.userId, departmentId: sales.id, createdAt: 0 });
    for (const permission of ["member.invite", "member.deactivate", "permission.assignment.manage"]) {
      await grantPermission(db, { tenantId, userId: manager.userId, permission, scope: "department" });
    }

    const salesAdmin = await setupExtraUser(db, { tenantId, email: "sales-admin@example.com", name: "営業部の管理者" });
    await upsertMembership(db, { tenantId, userId: salesAdmin.userId, departmentId: sales.id, createdAt: 0 });
    await assignPreset(db, { tenantId, userId: salesAdmin.userId, presetId: adminPresetId });

    const report = await setupExtraUser(db, { tenantId, email: "report@example.com", name: "部下" });
    await upsertMembership(db, { tenantId, userId: report.userId, departmentId: sales.id, createdAt: 0 });

    const managerCookie = await loginAndGetCookie(app, manager.email, manager.password);
    return { ...seeded, app, adminCookie, adminPresetId, sales, manager, managerCookie, salesAdmin, report };
  }

  const post = (app: RequestLike, path: string, cookie: string) =>
    app.request(path, { method: "POST", headers: { cookie } });

  it("部署スコープの担当者は、同じ部署の管理者へのリセット発行・無効化ができない(403)", async () => {
    const { db, tenantId, app, managerCookie, salesAdmin } = await scenario();

    // 以前は 201 で平文トークンが返り、管理者アカウントを乗っ取れた
    expect((await post(app, `/members/${salesAdmin.userId}/password-resets`, managerCookie)).status).toBe(403);
    expect((await post(app, `/members/${salesAdmin.userId}/two-factor/reset`, managerCookie)).status).toBe(403);
    expect((await post(app, `/members/${salesAdmin.userId}/deactivate`, managerCookie)).status).toBe(403);
    expect((await getUserById(db, { tenantId, id: salesAdmin.userId }))?.isActive).toBe(true);
    expect(await auditActionsFor(db, tenantId)).not.toContain("member.password_reset.issue");
  });

  it("部署スコープの担当者も、自分の権限を超えない同じ部署のメンバーは従来どおり操作できる", async () => {
    const { app, managerCookie, report } = await scenario();

    expect((await post(app, `/members/${report.userId}/password-resets`, managerCookie)).status).toBe(201);
    expect((await post(app, `/members/${report.userId}/deactivate`, managerCookie)).status).toBe(200);
    expect((await post(app, `/members/${report.userId}/reactivate`, managerCookie)).status).toBe(200);
  });

  it("同じ権限でも、操作者より広いスコープで持つ人は操作できない", async () => {
    const { db, tenantId, app, managerCookie, report } = await scenario();
    // 部下が member.invite をテナント全体で持つ(操作者は部署スコープ)
    await grantPermission(db, { tenantId, userId: report.userId, permission: "member.invite", scope: "tenant" });

    expect((await post(app, `/members/${report.userId}/password-resets`, managerCookie)).status).toBe(403);
  });

  it("テナント全体の管理者は、別の管理者にも従来どおりリセット発行・無効化ができる", async () => {
    const { app, adminCookie, salesAdmin } = await scenario();

    expect((await post(app, `/members/${salesAdmin.userId}/password-resets`, adminCookie)).status).toBe(201);
    expect((await post(app, `/members/${salesAdmin.userId}/deactivate`, adminCookie)).status).toBe(200);
    expect((await post(app, `/members/${salesAdmin.userId}/reactivate`, adminCookie)).status).toBe(200);
  });

  it("部署スコープの割当権限で、部下に「管理者」プリセットを付けられない(403)", async () => {
    const { db, tenantId, app, managerCookie, adminPresetId, report } = await scenario();

    const res = await app.request(`/members/${report.userId}/presets`, {
      method: "PUT",
      headers: { "content-type": "application/json", cookie: managerCookie },
      body: JSON.stringify({ presetIds: [adminPresetId] }),
    });
    // 以前は 200 で、自己昇格の判定は「対象 = 自分」のときしか走らなかった
    expect(res.status).toBe(403);
    expect(await listAssignedPresetGrants(db, { tenantId, userId: report.userId })).toEqual([]);
  });

  it("自分の権限に収まるプリセットなら、部下に割り当てられる", async () => {
    const { db, tenantId, app, managerCookie, report } = await scenario();
    const presetId = uuidv7();
    await db.insert(permissionPresets).values({
      id: presetId,
      tenantId,
      name: "招待担当",
      grants: JSON.stringify([{ key: "member.invite", scope: "department" }]),
      isSystem: false,
      createdAt: 0,
    });

    const res = await app.request(`/members/${report.userId}/presets`, {
      method: "PUT",
      headers: { "content-type": "application/json", cookie: managerCookie },
      body: JSON.stringify({ presetIds: [presetId] }),
    });
    expect(res.status).toBe(200);
  });

  it("部署スコープの担当者は、管理者の割当を外せない(403)", async () => {
    const { db, tenantId, app, managerCookie, salesAdmin } = await scenario();

    const res = await app.request(`/members/${salesAdmin.userId}/presets`, {
      method: "PUT",
      headers: { "content-type": "application/json", cookie: managerCookie },
      body: JSON.stringify({ presetIds: [] }),
    });
    expect(res.status).toBe(403);
    expect(await listAssignedPresetGrants(db, { tenantId, userId: salesAdmin.userId })).toHaveLength(1);
  });

  it("招待と同時に「管理者」プリセットを付けることもできず、メンバーも作られない(403)", async () => {
    const { db, tenantId, app, managerCookie, adminPresetId, sales } = await scenario();

    const res = await app.request("/members", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: managerCookie },
      body: JSON.stringify({ email: "new-admin@example.com", name: "新しい管理者", departmentId: sales.id, presetIds: [adminPresetId] }),
    });
    // 以前は 201 で招待トークンが返り、自分で受諾すれば管理者アカウントを得られた
    expect(res.status).toBe(403);
    const created = await db.select().from(users).where(eq(users.email, "new-admin@example.com"));
    expect(created).toEqual([]);
  });

  it("テナント全体の管理者は、従来どおり他人に「管理者」プリセットを割り当てられる", async () => {
    const { app, adminCookie, adminPresetId, report } = await scenario();

    const res = await app.request(`/members/${report.userId}/presets`, {
      method: "PUT",
      headers: { "content-type": "application/json", cookie: adminCookie },
      body: JSON.stringify({ presetIds: [adminPresetId] }),
    });
    expect(res.status).toBe(200);
  });
});
