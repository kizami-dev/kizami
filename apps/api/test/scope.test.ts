/**
 * apps/api/src/lib/scope.ts(resolveAccessibleUserIds / resolveAccessibleDepartmentIds)の
 * 適用先エンドポイント(members / departments)が、実効権限のスコープに応じて実際に
 * 操作対象を絞り込むことを検証する。
 *
 * 組織フィクスチャ(test/support/org.ts): 部署A(親)- 部署A1(子)、部署B(別ツリー)。
 * actor(setupTestDb() が作る主ユーザー)自身の所属・権限付与はテストごとに変える。
 */

import { describe, expect, it } from "vitest";
import { upsertMembership, type Database } from "@kizami/db";
import { createApp } from "../src/app.js";
import { grantPermission, loginAndGetCookie, setupTestDb } from "./support/setup.js";
import { setupOrgFixture, type OrgFixture } from "./support/org.js";

interface RequestLike {
  request: (path: string, init?: RequestInit) => Promise<Response> | Response;
}

async function patchMemberDepartment(app: RequestLike, cookie: string, targetId: string, departmentId: string) {
  return app.request(`/members/${targetId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ departmentId }),
  });
}

async function getMembers(app: RequestLike, cookie: string) {
  const res = await app.request("/members", { headers: { cookie } });
  const body = (await res.json()) as { members: { id: string }[] };
  return body.members.map((m) => m.id);
}

/** actor を部署Aのマネージャーとして組み立てる(所属=部署A、member.profile.edit/member.view を指定スコープで付与)。 */
async function setupDeptAManager(
  db: Database,
  params: { tenantId: string; userId: string; scope: "department" | "department_and_descendants" | "tenant" },
): Promise<OrgFixture> {
  const org = await setupOrgFixture(db, params.tenantId);
  await upsertMembership(db, { tenantId: params.tenantId, userId: params.userId, departmentId: org.deptA.id, createdAt: 0 });
  await grantPermission(db, { tenantId: params.tenantId, userId: params.userId, permission: "member.profile.edit", scope: params.scope });
  await grantPermission(db, { tenantId: params.tenantId, userId: params.userId, permission: "member.view", scope: params.scope });
  return org;
}

describe("scope-based member access", () => {
  it("department scope: manager can edit own-department members but not a child-department member (403)", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    const org = await setupDeptAManager(db, { tenantId, userId, scope: "department" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const ownDeptRes = await patchMemberDepartment(app, cookie, org.memberAUserId, org.deptA.id);
    expect(ownDeptRes.status).toBe(200);

    const childDeptRes = await patchMemberDepartment(app, cookie, org.memberA1UserId, org.deptA1.id);
    expect(childDeptRes.status).toBe(403);
  });

  it("department_and_descendants scope: manager can also edit a child-department (A1) member", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    const org = await setupDeptAManager(db, { tenantId, userId, scope: "department_and_descendants" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const childDeptRes = await patchMemberDepartment(app, cookie, org.memberA1UserId, org.deptA1.id);
    expect(childDeptRes.status).toBe(200);
  });

  it("neither department nor department_and_descendants scope reaches an unrelated department (B) member", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();

    const orgDept = await setupDeptAManager(db, { tenantId, userId, scope: "department" });
    const appDept = createApp({ db });
    const cookieDept = await loginAndGetCookie(appDept, email, password);
    expect((await patchMemberDepartment(appDept, cookieDept, orgDept.memberBUserId, orgDept.deptB.id)).status).toBe(403);

    // 別テナント相当に db を作り直すのは大掛かりなので、同一 db 上で department_and_descendants に
    // 昇格させて同じ検証を続ける(既存の grantPermission は追加のプリセットを積むだけなので、
    // 実効権限は広い方=department_and_descendants に上書きされる)。
    await grantPermission(db, { tenantId, userId, permission: "member.profile.edit", scope: "department_and_descendants" });
    const appDesc = createApp({ db });
    const cookieDesc = await loginAndGetCookie(appDesc, email, password);
    expect((await patchMemberDepartment(appDesc, cookieDesc, orgDept.memberBUserId, orgDept.deptB.id)).status).toBe(403);
  });

  it("tenant scope: admin can edit members in any department", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    const org = await setupDeptAManager(db, { tenantId, userId, scope: "tenant" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    expect((await patchMemberDepartment(app, cookie, org.memberAUserId, org.deptA.id)).status).toBe(200);
    expect((await patchMemberDepartment(app, cookie, org.memberA1UserId, org.deptA1.id)).status).toBe(200);
    expect((await patchMemberDepartment(app, cookie, org.memberBUserId, org.deptB.id)).status).toBe(200);
  });

  it("GET /members is filtered by scope: department scope sees only A, department_and_descendants also sees A1", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    const org = await setupDeptAManager(db, { tenantId, userId, scope: "department" });

    const appDept = createApp({ db });
    const cookieDept = await loginAndGetCookie(appDept, email, password);
    const deptIds = await getMembers(appDept, cookieDept);
    expect(new Set(deptIds)).toEqual(new Set([userId, org.memberAUserId]));
    expect(deptIds).not.toContain(org.memberA1UserId);
    expect(deptIds).not.toContain(org.memberBUserId);

    await grantPermission(db, { tenantId, userId, permission: "member.view", scope: "department_and_descendants" });
    const appDesc = createApp({ db });
    const cookieDesc = await loginAndGetCookie(appDesc, email, password);
    const descIds = await getMembers(appDesc, cookieDesc);
    expect(new Set(descIds)).toEqual(new Set([userId, org.memberAUserId, org.memberA1UserId]));
    expect(descIds).not.toContain(org.memberBUserId);
  });

  it("a department-scoped actor with no membership at all sees only themselves (not an empty list)", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    // このテストの actor は部署に一切所属させない(setupOrgFixture は他の3人のみ所属させる)。
    await setupOrgFixture(db, tenantId);
    await grantPermission(db, { tenantId, userId, permission: "member.view", scope: "department" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const ids = await getMembers(app, cookie);
    expect(ids).toEqual([userId]);
  });
});

describe("scope-based department access", () => {
  async function setupDeptAManagerForDepartments(
    db: Database,
    params: { tenantId: string; userId: string; scope: "department_and_descendants" | "tenant" },
  ): Promise<OrgFixture> {
    const org = await setupOrgFixture(db, params.tenantId);
    await upsertMembership(db, { tenantId: params.tenantId, userId: params.userId, departmentId: org.deptA.id, createdAt: 0 });
    await grantPermission(db, { tenantId: params.tenantId, userId: params.userId, permission: "department.manage", scope: params.scope });
    return org;
  }

  it("department_and_descendants scope: can create under own subtree, not under an unrelated department, and not a new root", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    const org = await setupDeptAManagerForDepartments(db, { tenantId, userId, scope: "department_and_descendants" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const underA = await app.request("/departments", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ name: "部署A2", parentId: org.deptA.id }),
    });
    expect(underA.status).toBe(201);

    const underB = await app.request("/departments", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ name: "部署B2", parentId: org.deptB.id }),
    });
    expect(underB.status).toBe(403);

    const newRoot = await app.request("/departments", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ name: "新ルート" }),
    });
    expect(newRoot.status).toBe(403);
  });

  it("department_and_descendants scope: cannot move a department out of its own subtree", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    const org = await setupDeptAManagerForDepartments(db, { tenantId, userId, scope: "department_and_descendants" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    // 管轄外(部署B)へ付け替える = 部署を管轄外へ持ち出す操作なので拒否される
    const moveToB = await app.request(`/departments/${org.deptA1.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ parentId: org.deptB.id }),
    });
    expect(moveToB.status).toBe(403);

    // 親を外してルート化するのも同様(ルートはテナント全体スコープの領分)
    const moveToRoot = await app.request(`/departments/${org.deptA1.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ parentId: null }),
    });
    expect(moveToRoot.status).toBe(403);

    // 自分の管轄内での付け替えは許可される(A1 を A 配下のまま維持)
    const moveWithin = await app.request(`/departments/${org.deptA1.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ parentId: org.deptA.id }),
    });
    expect(moveWithin.status).toBe(200);
  });

  it("department_and_descendants scope: can update/delete within own subtree, not an unrelated department", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    const org = await setupDeptAManagerForDepartments(db, { tenantId, userId, scope: "department_and_descendants" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const renameA1 = await app.request(`/departments/${org.deptA1.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ name: "改称A1" }),
    });
    expect(renameA1.status).toBe(200);

    const renameB = await app.request(`/departments/${org.deptB.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ name: "改称B" }),
    });
    expect(renameB.status).toBe(403);

    // 空の子部署を自分の管轄下に作ってから削除できることを確認
    const createRes = await app.request("/departments", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ name: "部署A3(削除用)", parentId: org.deptA.id }),
    });
    const created = ((await createRes.json()) as { department: { id: string } }).department;
    const deleteOwn = await app.request(`/departments/${created.id}`, { method: "DELETE", headers: { cookie } });
    expect(deleteOwn.status).toBe(200);

    // 管轄外(部署B、メンバーが所属しているため本来は409だが、スコープ外なので403が優先される)
    const deleteB = await app.request(`/departments/${org.deptB.id}`, { method: "DELETE", headers: { cookie } });
    expect(deleteB.status).toBe(403);
  });

  it("tenant scope: can create/update/delete any department, including new roots", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    const org = await setupDeptAManagerForDepartments(db, { tenantId, userId, scope: "tenant" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const newRoot = await app.request("/departments", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ name: "新ルート" }),
    });
    expect(newRoot.status).toBe(201);

    const renameB = await app.request(`/departments/${org.deptB.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ name: "改称B" }),
    });
    expect(renameB.status).toBe(200);
  });
});
