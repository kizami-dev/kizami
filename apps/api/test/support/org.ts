/**
 * スコープ判定(apps/api/src/lib/scope.ts)のテスト用フィクスチャ。
 *
 * 部署A(親)- 部署A1(子)、部署B(Aとは無関係の別ツリー)という組織を組み立て、
 * それぞれの部署に1人ずつメンバーを所属させる。actor(主人格。テストの主語となる
 * マネージャー/管理者)自身の所属・権限付与は各テストケースごとに異なるスコープを
 * 検証したいため、ここでは固定せず呼び出し側(setupTestDb() が作る userId)に
 * upsertMembership / grantPermission で個別に設定させる。
 */

import { authCredentials, createDepartment, upsertMembership, users, uuidv7, type Database, type Department } from "@kizami/db";
import { hashPassword } from "../../src/auth/password.js";

export interface OrgFixture {
  deptA: Department;
  deptA1: Department;
  deptB: Department;
  /** 部署Aに所属する、actorとは別のメンバー。 */
  memberAUserId: string;
  /** 部署A1(部署Aの子)に所属するメンバー。 */
  memberA1UserId: string;
  /** 部署Bに所属するメンバー。 */
  memberBUserId: string;
}

let emailCounter = 0;

/** ログインはしない(スコープ判定の対象=targetとしてのみ使う)ダミーユーザーを作る。 */
async function createPlainUser(db: Database, tenantId: string, name: string): Promise<string> {
  const now = 0;
  const userId = uuidv7();
  emailCounter += 1;
  await db.insert(users).values({
    id: userId,
    tenantId,
    email: `org-fixture-${emailCounter}@example.com`,
    name,
    isActive: true,
    createdAt: now,
  });
  await db.insert(authCredentials).values({
    id: uuidv7(),
    tenantId,
    userId,
    passwordHash: await hashPassword("unused - this user never logs in"),
    createdAt: now,
    updatedAt: now,
  });
  return userId;
}

export async function setupOrgFixture(db: Database, tenantId: string): Promise<OrgFixture> {
  const now = 0;
  const deptA = await createDepartment(db, { id: uuidv7(), tenantId, name: "部署A", parentId: null, createdAt: now });
  const deptA1 = await createDepartment(db, { id: uuidv7(), tenantId, name: "部署A1", parentId: deptA.id, createdAt: now });
  const deptB = await createDepartment(db, { id: uuidv7(), tenantId, name: "部署B", parentId: null, createdAt: now });

  const memberAUserId = await createPlainUser(db, tenantId, "Member A");
  const memberA1UserId = await createPlainUser(db, tenantId, "Member A1");
  const memberBUserId = await createPlainUser(db, tenantId, "Member B");

  await upsertMembership(db, { tenantId, userId: memberAUserId, departmentId: deptA.id, createdAt: now });
  await upsertMembership(db, { tenantId, userId: memberA1UserId, departmentId: deptA1.id, createdAt: now });
  await upsertMembership(db, { tenantId, userId: memberBUserId, departmentId: deptB.id, createdAt: now });

  return { deptA, deptA1, deptB, memberAUserId, memberA1UserId, memberBUserId };
}
