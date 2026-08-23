/**
 * 他人の勤怠閲覧(Tier 1)。GET /attendance/monthly?userId= のスコープ検証と
 * GET /attendance/members。参照: apps/api/src/routes/attendance.ts 冒頭コメント、
 * docs/design/permission-catalog.md §1.3(attendance.record.view)。
 *
 * スコープ判定の組織フィクスチャは test/support/org.ts(部署A(親)- 部署A1(子)、部署B)を
 * 再利用する(test/scope.test.ts と同じ流儀)。
 */

import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  insertPunchEvent,
  upsertMembership,
  userPolicyAssignments,
  uuidv7,
  workPolicies,
  type Database,
} from "@kizami/db";
import { createApp } from "../src/app.js";
import { grantPermission, jstMinutes, loginAndGetCookie, setupTestDb } from "./support/setup.js";
import { setupOrgFixture, type OrgFixture } from "./support/org.js";

interface RequestLike {
  request: (path: string, init?: RequestInit) => Promise<Response> | Response;
}

/** setupTestDb() が作るテナントの既定 work_policy(Flex)を対象ユーザーにも割り当てる。 */
async function assignExistingWorkPolicy(db: Database, tenantId: string, userId: string): Promise<void> {
  const rows = await db.select().from(workPolicies).where(eq(workPolicies.tenantId, tenantId)).limit(1);
  const workPolicyId = rows[0]?.id;
  if (!workPolicyId) {
    throw new Error("assignExistingWorkPolicy: no work_policies row found for tenant");
  }
  await db.insert(userPolicyAssignments).values({
    id: uuidv7(),
    tenantId,
    userId,
    workPolicyId,
    effectiveFrom: "1970-01-01",
    createdAt: 0,
  });
}

async function punchADay(
  db: Database,
  params: { tenantId: string; userId: string; year: number; month: number; day: number; startHour: number; endHour: number },
): Promise<void> {
  const { tenantId, userId, year, month, day, startHour, endHour } = params;
  const clockInAt = jstMinutes(year, month, day, startHour, 0);
  const clockOutAt = jstMinutes(year, month, day, endHour, 0);
  await insertPunchEvent(db, { tenantId, userId, kind: "clock_in", occurredAt: clockInAt, recordedAt: clockInAt, source: "web", actorId: userId });
  await insertPunchEvent(db, { tenantId, userId, kind: "clock_out", occurredAt: clockOutAt, recordedAt: clockOutAt, source: "web", actorId: userId });
}

async function getMonthly(app: RequestLike, cookie: string, month: string, userId?: string) {
  const query = userId !== undefined ? `?month=${month}&userId=${userId}` : `?month=${month}`;
  const res = await app.request(`/attendance/monthly${query}`, { headers: { cookie } });
  return { status: res.status, body: res.status === 200 ? await res.json() : await res.json().catch(() => undefined) };
}

async function getMembers(app: RequestLike, cookie: string) {
  const res = await app.request("/attendance/members", { headers: { cookie } });
  const body = (await res.json()) as { members: Array<{ id: string; name: string; departmentId: string | null }> };
  return { status: res.status, members: body.members };
}

/** actor を部署Aに所属させ、attendance.record.view を指定スコープで付与する。 */
async function setupDeptAViewer(
  db: Database,
  params: { tenantId: string; userId: string; scope: "department" | "department_and_descendants" | "tenant" },
): Promise<OrgFixture> {
  const org = await setupOrgFixture(db, params.tenantId);
  await upsertMembership(db, { tenantId: params.tenantId, userId: params.userId, departmentId: org.deptA.id, createdAt: 0 });
  await grantPermission(db, { tenantId: params.tenantId, userId: params.userId, permission: "attendance.record.view", scope: params.scope });
  return org;
}

describe("GET /attendance/monthly?userId= (viewing another user's attendance)", () => {
  it("omitting userId or passing one's own id always works, even without attendance.record.view", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const omitted = await getMonthly(app, cookie, "2026-04");
    expect(omitted.status).toBe(200);
    expect((omitted.body as { user: { id: string } }).user.id).toBe(userId);

    const explicitSelf = await getMonthly(app, cookie, "2026-04", userId);
    expect(explicitSelf.status).toBe(200);
    expect((explicitSelf.body as { user: { id: string } }).user.id).toBe(userId);
  });

  it("requesting another user's month without attendance.record.view at all is 403 (actor's own missing permission, not the target's existence)", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    const org = await setupOrgFixture(db, tenantId);
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const res = await getMonthly(app, cookie, "2026-04", org.memberAUserId);
    expect(res.status).toBe(403);
  });

  it("department scope: can view a same-department member's month, but an unrelated department (B) member is 404, not 403", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    const org = await setupDeptAViewer(db, { tenantId, userId, scope: "department" });
    await assignExistingWorkPolicy(db, tenantId, org.memberAUserId);
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const inScope = await getMonthly(app, cookie, "2026-04", org.memberAUserId);
    expect(inScope.status).toBe(200);
    expect((inScope.body as { user: { id: string; name: string } }).user).toEqual({ id: org.memberAUserId, name: "Member A" });

    // スコープ外(存在推測を避けるため404であり403ではない — ファイル冒頭コメント参照)
    const outOfScope = await getMonthly(app, cookie, "2026-04", org.memberBUserId);
    expect(outOfScope.status).toBe(404);

    // 部署A1(部署Aの子)は department スコープでは対象外(department_and_descendants が必要)
    const childDept = await getMonthly(app, cookie, "2026-04", org.memberA1UserId);
    expect(childDept.status).toBe(404);
  });

  it("department_and_descendants scope additionally reaches a child-department (A1) member", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    const org = await setupDeptAViewer(db, { tenantId, userId, scope: "department_and_descendants" });
    await assignExistingWorkPolicy(db, tenantId, org.memberA1UserId);
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const res = await getMonthly(app, cookie, "2026-04", org.memberA1UserId);
    expect(res.status).toBe(200);
    expect((res.body as { user: { id: string } }).user.id).toBe(org.memberA1UserId);
  });

  it("a nonexistent userId within an all-tenant-scope actor's reach is 404", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: "attendance.record.view", scope: "tenant" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const res = await getMonthly(app, cookie, "2026-04", uuidv7());
    expect(res.status).toBe(404);
  });

  it("a closed month's snapshot is the target user's own figures, not the actor's (department scope)", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    const org = await setupDeptAViewer(db, { tenantId, userId, scope: "department" });
    await assignExistingWorkPolicy(db, tenantId, org.memberAUserId);
    await grantPermission(db, { tenantId, userId, permission: "closing.execute", scope: "tenant" });

    // actor: 9:00-18:00(9h、休憩なし)。memberA: 9:00-13:00(4h、休憩なし) — 明確に違う値にする。
    await punchADay(db, { tenantId, userId, year: 2026, month: 4, day: 1, startHour: 9, endHour: 18 });
    await punchADay(db, { tenantId, userId: org.memberAUserId, year: 2026, month: 4, day: 1, startHour: 9, endHour: 13 });

    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const actorBefore = await getMonthly(app, cookie, "2026-04");
    const memberBefore = await getMonthly(app, cookie, "2026-04", org.memberAUserId);
    expect(actorBefore.status).toBe(200);
    expect(memberBefore.status).toBe(200);
    const actorLiveTotals = (actorBefore.body as { figures: { totals: { statutory: number } } }).figures.totals;
    const memberLiveTotals = (memberBefore.body as { figures: { totals: { statutory: number } } }).figures.totals;
    expect(actorLiveTotals.statutory).not.toBe(memberLiveTotals.statutory);

    const closeRes = await app.request("/closings/2026-04/close", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({}),
    });
    expect(closeRes.status).toBe(200);

    const memberAfter = await getMonthly(app, cookie, "2026-04", org.memberAUserId);
    expect(memberAfter.status).toBe(200);
    const memberAfterBody = memberAfter.body as {
      user: { id: string };
      figures: { source: string; totals: { statutory: number } };
      closing: { closed: boolean };
    };
    expect(memberAfterBody.user.id).toBe(org.memberAUserId);
    expect(memberAfterBody.closing.closed).toBe(true);
    expect(memberAfterBody.figures.source).toBe("snapshot");
    // 締め済みでも「対象ユーザー本人」の値のまま(actorの値に化けていない)。
    expect(memberAfterBody.figures.totals.statutory).toBe(memberLiveTotals.statutory);

    const actorAfter = await getMonthly(app, cookie, "2026-04");
    const actorAfterBody = actorAfter.body as { figures: { totals: { statutory: number } } };
    expect(actorAfterBody.figures.totals.statutory).toBe(actorLiveTotals.statutory);
    expect(actorAfterBody.figures.totals.statutory).not.toBe(memberAfterBody.figures.totals.statutory);
  });
});

describe("GET /attendance/members", () => {
  it("returns only self when the actor has no attendance.record.view at all", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await setupOrgFixture(db, tenantId); // 他のメンバーが存在していても漏れないことを確認する
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const { status, members } = await getMembers(app, cookie);
    expect(status).toBe(200);
    expect(members.map((m) => m.id)).toEqual([userId]);
  });

  it("department scope: returns self + same-department members only (not the child department, not an unrelated department)", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    const org = await setupDeptAViewer(db, { tenantId, userId, scope: "department" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const { status, members } = await getMembers(app, cookie);
    expect(status).toBe(200);
    const ids = members.map((m) => m.id).sort();
    expect(ids).toEqual([userId, org.memberAUserId].sort());
    const memberA = members.find((m) => m.id === org.memberAUserId);
    expect(memberA?.departmentId).toBe(org.deptA.id);
  });

  it("department_and_descendants scope: additionally includes the child-department (A1) member", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    const org = await setupDeptAViewer(db, { tenantId, userId, scope: "department_and_descendants" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const { members } = await getMembers(app, cookie);
    const ids = members.map((m) => m.id).sort();
    expect(ids).toEqual([userId, org.memberAUserId, org.memberA1UserId].sort());
    expect(ids).not.toContain(org.memberBUserId);
  });

  it("tenant scope: includes every member in the tenant", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    const org = await setupDeptAViewer(db, { tenantId, userId, scope: "tenant" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const { members } = await getMembers(app, cookie);
    const ids = members.map((m) => m.id).sort();
    expect(ids).toEqual([userId, org.memberAUserId, org.memberA1UserId, org.memberBUserId].sort());
  });
});
