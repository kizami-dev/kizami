import { describe, expect, it } from "vitest";
import {
  createDepartment,
  insertLeaveGrant,
  upsertMembership,
  uuidv7,
  workPolicies,
  workPolicyVersions,
  userPolicyAssignments,
  type Database,
} from "@kizami/db";
import { createApp } from "../src/app.js";
import { grantPermission, loginAndGetCookie, setupSecondUser, setupTestDb } from "./support/setup.js";

/** このファイルの承認系テストは軒並み自己承認を行うため、共通ヘルパーにまとめる
 * (2026-08-23: 承認は leave.request.approve 権限ベースに統一された —
 * routes/leave.ts のヘッダコメント参照。自己承認であってもこの権限が要る)。 */
async function grantApprovePermission(db: Database, tenantId: string, userId: string) {
  await grantPermission(db, { tenantId, userId, permission: "leave.request.approve", scope: "tenant" });
}

async function grantAnnual(db: Database, params: { tenantId: string; userId: string; grantedOn: string; days: number; expiresOn: string }) {
  return insertLeaveGrant(db, {
    tenantId: params.tenantId,
    userId: params.userId,
    leaveType: "annual",
    grantedOn: params.grantedOn,
    days: params.days,
    expiresOn: params.expiresOn,
    source: "manual",
    createdAt: 0,
  });
}

/** setupSecondUser() は打刻・修正申請テスト用に work_policy を割り当てないため、
 * 有給の残高計算(buildSettingsTimeline が標準労働時間の解決に work policy を要求する)には
 * 別途割り当てが必要。 */
async function assignWorkPolicy(db: Database, params: { tenantId: string; userId: string }): Promise<void> {
  const workPolicyId = uuidv7();
  await db.insert(workPolicies).values({ id: workPolicyId, tenantId: params.tenantId, name: "Flex", createdAt: 0 });
  await db.insert(workPolicyVersions).values({
    id: uuidv7(),
    tenantId: params.tenantId,
    workPolicyId,
    effectiveFrom: "1970-01-01",
    settlementPeriod: "monthly",
    core: null,
    standardDayMinutes: 480,
    createdAt: 0,
  });
  await db.insert(userPolicyAssignments).values({
    id: uuidv7(),
    tenantId: params.tenantId,
    userId: params.userId,
    workPolicyId,
    effectiveFrom: "1970-01-01",
    createdAt: 0,
  });
}

interface LeaveRequestJson {
  id: string;
  userId: string;
  status: string;
  leaveDate: string;
  unit: string;
  minutes: number | null;
  leaveType: string;
}

describe("leave requests API", () => {
  it("POST /leave/requests rejects with 409 insufficient_balance when the user has no grants", async () => {
    const { db, email, password } = await setupTestDb();
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const res = await app.request("/leave/requests", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ leaveDate: "2026-04-10", reason: "私用のため" }),
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "insufficient_balance" });
  });

  it("full_day request -> approve -> withdraw is no longer possible; duplicate full_day on the same date is rejected", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantAnnual(db, { tenantId, userId, grantedOn: "2020-01-01", days: 10, expiresOn: "2099-01-01" });
    await grantApprovePermission(db, tenantId, userId);
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const createRes = await app.request("/leave/requests", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ leaveDate: "2026-04-10", reason: "私用のため" }),
    });
    expect(createRes.status).toBe(201);
    const created = ((await createRes.json()) as { request: LeaveRequestJson }).request;
    expect(created.status).toBe("pending");
    expect(created.unit).toBe("full_day");

    // 同じ日に重複申請 -> 409
    const dupRes = await app.request("/leave/requests", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ leaveDate: "2026-04-10", reason: "また休みたい" }),
    });
    expect(dupRes.status).toBe(409);
    expect(await dupRes.json()).toEqual({ error: "duplicate_request" });

    const approveRes = await app.request(`/leave/requests/${created.id}/approve`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({}),
    });
    expect(approveRes.status).toBe(200);
    const approved = ((await approveRes.json()) as { request: LeaveRequestJson }).request;
    expect(approved.status).toBe("approved");

    // 承認済みは pending からの遷移のみ許可される withdraw では動かない
    const withdrawRes = await app.request(`/leave/requests/${created.id}/withdraw`, {
      method: "POST",
      headers: { cookie },
    });
    expect(withdrawRes.status).toBe(409);
  });

  it("reject and withdraw flows work like corrections (pending only, requestedBy only)", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantAnnual(db, { tenantId, userId, grantedOn: "2020-01-01", days: 10, expiresOn: "2099-01-01" });
    await grantApprovePermission(db, tenantId, userId);
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const rejectTarget = await app.request("/leave/requests", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ leaveDate: "2026-04-10", reason: "A" }),
    });
    const rejectId = ((await rejectTarget.json()) as { request: LeaveRequestJson }).request.id;
    const rejectRes = await app.request(`/leave/requests/${rejectId}/reject`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ note: "業務都合" }),
    });
    expect(rejectRes.status).toBe(200);
    expect(((await rejectRes.json()) as { request: LeaveRequestJson }).request.status).toBe("rejected");

    // 却下後、同じ日に再申請できる(重複防止は pending/approved のみが対象)
    const retryRes = await app.request("/leave/requests", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ leaveDate: "2026-04-10", reason: "再申請" }),
    });
    expect(retryRes.status).toBe(201);
    const retryId = ((await retryRes.json()) as { request: LeaveRequestJson }).request.id;

    const withdrawRes = await app.request(`/leave/requests/${retryId}/withdraw`, { method: "POST", headers: { cookie } });
    expect(withdrawRes.status).toBe(200);
    expect(((await withdrawRes.json()) as { request: LeaveRequestJson }).request.status).toBe("withdrawn");
  });

  it("a different user without leave.request.approve cannot approve someone else's request (403)", async () => {
    const { db, tenantId, email, password } = await setupTestDb();
    const second = await setupSecondUser(db, tenantId);
    await assignWorkPolicy(db, { tenantId, userId: second.userId });
    await grantAnnual(db, { tenantId, userId: second.userId, grantedOn: "2020-01-01", days: 10, expiresOn: "2099-01-01" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);
    const secondCookie = await loginAndGetCookie(app, second.email, second.password);

    const createRes = await app.request("/leave/requests", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: secondCookie },
      body: JSON.stringify({ leaveDate: "2026-04-10", reason: "A" }),
    });
    const id = ((await createRes.json()) as { request: LeaveRequestJson }).request.id;

    // approver (cookie) には leave.request.approve を付与していない
    const approveRes = await app.request(`/leave/requests/${id}/approve`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({}),
    });
    expect(approveRes.status).toBe(403);
  });

  // 2026-08-23: 承認方式を requestedBy 自身のみの自己承認から leave.request.approve
  // 権限ベース(+ スコープ)へ統一(routes/leave.ts ヘッダコメント参照)。
  describe("permission-based authorization", () => {
    it("even self-approval is rejected with 403 without leave.request.approve", async () => {
      const { db, tenantId, userId, email, password } = await setupTestDb();
      await grantAnnual(db, { tenantId, userId, grantedOn: "2020-01-01", days: 10, expiresOn: "2099-01-01" });
      const app = createApp({ db });
      const cookie = await loginAndGetCookie(app, email, password);

      const createRes = await app.request("/leave/requests", {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ leaveDate: "2026-04-10", reason: "A" }),
      });
      const id = ((await createRes.json()) as { request: LeaveRequestJson }).request.id;

      const approveRes = await app.request(`/leave/requests/${id}/approve`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({}),
      });
      expect(approveRes.status).toBe(403);

      const rejectRes = await app.request(`/leave/requests/${id}/reject`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({}),
      });
      expect(rejectRes.status).toBe(403);
    });

    it("a tenant-scoped approver can approve another user's request", async () => {
      const { db, tenantId, userId, email, password } = await setupTestDb();
      await grantApprovePermission(db, tenantId, userId);
      const requester = await setupSecondUser(db, tenantId);
      await assignWorkPolicy(db, { tenantId, userId: requester.userId });
      await grantAnnual(db, { tenantId, userId: requester.userId, grantedOn: "2020-01-01", days: 10, expiresOn: "2099-01-01" });
      const app = createApp({ db });
      const approverCookie = await loginAndGetCookie(app, email, password);
      const requesterCookie = await loginAndGetCookie(app, requester.email, requester.password);

      const createRes = await app.request("/leave/requests", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: requesterCookie },
        body: JSON.stringify({ leaveDate: "2026-04-10", reason: "A" }),
      });
      const id = ((await createRes.json()) as { request: LeaveRequestJson }).request.id;

      const approveRes = await app.request(`/leave/requests/${id}/approve`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: approverCookie },
        body: JSON.stringify({}),
      });
      expect(approveRes.status).toBe(200);
      const approved = ((await approveRes.json()) as { request: LeaveRequestJson & { decidedBy: string } }).request;
      expect(approved.status).toBe("approved");
      expect(approved.decidedBy).toBe(userId);
    });

    it("a department-scoped manager can approve a same-department subordinate, but not an out-of-scope member (403)", async () => {
      const { db, tenantId, userId: managerId, email: managerEmail, password: managerPassword } = await setupTestDb();
      const deptA = await createDepartment(db, { id: uuidv7(), tenantId, name: "部署A", parentId: null, createdAt: 0 });
      const deptB = await createDepartment(db, { id: uuidv7(), tenantId, name: "部署B", parentId: null, createdAt: 0 });
      await upsertMembership(db, { tenantId, userId: managerId, departmentId: deptA.id, createdAt: 0 });
      await grantPermission(db, { tenantId, userId: managerId, permission: "leave.request.approve", scope: "department" });

      const subordinate = await setupSecondUser(db, tenantId);
      await upsertMembership(db, { tenantId, userId: subordinate.userId, departmentId: deptA.id, createdAt: 0 });
      await assignWorkPolicy(db, { tenantId, userId: subordinate.userId });
      await grantAnnual(db, { tenantId, userId: subordinate.userId, grantedOn: "2020-01-01", days: 10, expiresOn: "2099-01-01" });

      const app = createApp({ db });
      const managerCookie = await loginAndGetCookie(app, managerEmail, managerPassword);
      const subordinateCookie = await loginAndGetCookie(app, subordinate.email, subordinate.password);

      const inScopeCreate = await app.request("/leave/requests", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: subordinateCookie },
        body: JSON.stringify({ leaveDate: "2026-04-10", reason: "A" }),
      });
      const inScopeId = ((await inScopeCreate.json()) as { request: LeaveRequestJson }).request.id;
      const inScopeApprove = await app.request(`/leave/requests/${inScopeId}/approve`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: managerCookie },
        body: JSON.stringify({}),
      });
      expect(inScopeApprove.status).toBe(200);

      // 部署Bに異動させると、department スコープの管理者からは見えなくなる。
      await upsertMembership(db, { tenantId, userId: subordinate.userId, departmentId: deptB.id, createdAt: 0 });
      const outOfScopeCreate = await app.request("/leave/requests", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: subordinateCookie },
        body: JSON.stringify({ leaveDate: "2026-04-11", reason: "B" }),
      });
      const outOfScopeId = ((await outOfScopeCreate.json()) as { request: LeaveRequestJson }).request.id;
      const outOfScopeApprove = await app.request(`/leave/requests/${outOfScopeId}/approve`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: managerCookie },
        body: JSON.stringify({}),
      });
      expect(outOfScopeApprove.status).toBe(403);
    });

    it("approving/rejecting another user's request creates an in-app notification for the requester; self-approval does not", async () => {
      const { db, tenantId, userId, email, password } = await setupTestDb();
      await grantApprovePermission(db, tenantId, userId);
      const requester = await setupSecondUser(db, tenantId);
      await assignWorkPolicy(db, { tenantId, userId: requester.userId });
      await grantAnnual(db, { tenantId, userId: requester.userId, grantedOn: "2020-01-01", days: 10, expiresOn: "2099-01-01" });
      const app = createApp({ db });
      const approverCookie = await loginAndGetCookie(app, email, password);
      const requesterCookie = await loginAndGetCookie(app, requester.email, requester.password);

      const approvedCreate = await app.request("/leave/requests", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: requesterCookie },
        body: JSON.stringify({ leaveDate: "2026-04-10", reason: "A" }),
      });
      const approvedId = ((await approvedCreate.json()) as { request: LeaveRequestJson }).request.id;
      const approveRes = await app.request(`/leave/requests/${approvedId}/approve`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: approverCookie },
        body: JSON.stringify({}),
      });
      expect(approveRes.status).toBe(200);

      const rejectedCreate = await app.request("/leave/requests", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: requesterCookie },
        body: JSON.stringify({ leaveDate: "2026-04-11", reason: "B" }),
      });
      const rejectedId = ((await rejectedCreate.json()) as { request: LeaveRequestJson }).request.id;
      const rejectRes = await app.request(`/leave/requests/${rejectedId}/reject`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: approverCookie },
        body: JSON.stringify({ note: "業務都合" }),
      });
      expect(rejectRes.status).toBe(200);

      const notifRes = await app.request("/notifications", { headers: { cookie: requesterCookie } });
      const notifBody = (await notifRes.json()) as { notifications: Array<{ type: string }> };
      const types = notifBody.notifications.map((n) => n.type);
      expect(types).toContain("leave_request_approved");
      expect(types).toContain("leave_request_rejected");

      // 自己承認では通知を作らない
      await grantAnnual(db, { tenantId, userId, grantedOn: "2020-01-02", days: 10, expiresOn: "2099-01-01" });
      const selfCreate = await app.request("/leave/requests", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: approverCookie },
        body: JSON.stringify({ leaveDate: "2026-04-12", reason: "C" }),
      });
      const selfId = ((await selfCreate.json()) as { request: LeaveRequestJson }).request.id;
      const selfApproveRes = await app.request(`/leave/requests/${selfId}/approve`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: approverCookie },
        body: JSON.stringify({}),
      });
      expect(selfApproveRes.status).toBe(200);

      const selfNotifRes = await app.request("/notifications", { headers: { cookie: approverCookie } });
      const selfNotifBody = (await selfNotifRes.json()) as { notifications: Array<{ type: string }> };
      expect(selfNotifBody.notifications.map((n) => n.type)).not.toContain("leave_request_approved");
    });
  });

  it("morning + afternoon half-day requests on the same date both succeed", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantAnnual(db, { tenantId, userId, grantedOn: "2020-01-01", days: 10, expiresOn: "2099-01-01" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const am = await app.request("/leave/requests", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ leaveDate: "2026-04-10", reason: "午前休", unit: "half_day_am" }),
    });
    expect(am.status).toBe(201);

    const pm = await app.request("/leave/requests", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ leaveDate: "2026-04-10", reason: "午後休", unit: "half_day_pm" }),
    });
    expect(pm.status).toBe(201);

    // 同じ am をもう一度申請すると 409
    const dupAm = await app.request("/leave/requests", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ leaveDate: "2026-04-10", reason: "午前休2", unit: "half_day_am" }),
    });
    expect(dupAm.status).toBe(409);
    expect(await dupAm.json()).toEqual({ error: "duplicate_request" });
  });

  it("hourly requests are rejected with 400 hourly_leave_disabled unless the tenant enabled it", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantAnnual(db, { tenantId, userId, grantedOn: "2020-01-01", days: 10, expiresOn: "2099-01-01" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const res = await app.request("/leave/requests", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ leaveDate: "2026-04-10", reason: "通院のため", unit: "hourly", minutes: 120 }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "hourly_leave_disabled" });
  });

  describe("GET /leave/balance for other users", () => {
    it("403 without leave.balance.view", async () => {
      const { db, tenantId, email, password } = await setupTestDb();
      const second = await setupSecondUser(db, tenantId);
      const app = createApp({ db });
      const cookie = await loginAndGetCookie(app, email, password);

      const res = await app.request(`/leave/balance?userId=${second.userId}`, { headers: { cookie } });
      expect(res.status).toBe(403);
    });

    it("200 with leave.balance.view and the target user is in scope", async () => {
      const { db, tenantId, userId, email, password } = await setupTestDb();
      const second = await setupSecondUser(db, tenantId);
      await assignWorkPolicy(db, { tenantId, userId: second.userId });
      await grantAnnual(db, { tenantId, userId: second.userId, grantedOn: "2020-01-01", days: 10, expiresOn: "2099-01-01" });
      await grantPermission(db, { tenantId, userId, permission: "leave.balance.view", scope: "tenant" });
      const app = createApp({ db });
      const cookie = await loginAndGetCookie(app, email, password);

      const res = await app.request(`/leave/balance?userId=${second.userId}`, { headers: { cookie } });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { annual: { totalGrantedMinutes: number } };
      expect(body.annual.totalGrantedMinutes).toBe(10 * 480);
    });
  });
});

describe("GET /leave/capabilities", () => {
  it("lets a member without leave.grant.manage read what they can request", async () => {
    const seeded = await setupTestDb();
    const app = createApp({ db: seeded.db });
    const cookie = await loginAndGetCookie(app, seeded.email, seeded.password);

    // 設定は権限が要るので読めないが、申請に必要な情報は読める
    const settingsRes = await app.request("/settings/leave", { headers: { cookie } });
    expect(settingsRes.status).toBe(403);

    const res = await app.request("/leave/capabilities", { headers: { cookie } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      hourlyLeaveEnabled: boolean;
      halfDayLeaveEnabled: boolean;
      hourlyLeaveMaxDays: number;
      standardDayMinutes: number;
    };
    expect(typeof body.hourlyLeaveEnabled).toBe("boolean");
    expect(typeof body.halfDayLeaveEnabled).toBe("boolean");
    expect(body.hourlyLeaveMaxDays).toBeGreaterThanOrEqual(1);
    expect(body.standardDayMinutes).toBeGreaterThan(0);
  });

  it("requires authentication", async () => {
    const seeded = await setupTestDb();
    const app = createApp({ db: seeded.db });
    const res = await app.request("/leave/capabilities");
    expect(res.status).toBe(401);
  });
});
