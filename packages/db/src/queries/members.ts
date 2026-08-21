/**
 * メンバー一覧・所属(memberships)まわりのクエリ。
 *
 * memberships はユーザー1人につき複数行あり得るスキーマ(packages/db/src/schema/org.ts に
 * unique制約なし)だが、v0.1〜v0.2 のアプリ側は「1ユーザー=1所属部署」として扱う。
 * ここでは createdAt 降順で先頭(最新)の1行を「現在の所属」とみなす規約を採用する
 * (判断点: スキーマ上は複数所属を禁止していないが、要件・API仕様は単一所属を前提とする
 * ため、実装側でこの規約を定めた)。
 */

import { and, desc, eq } from "drizzle-orm";
import type { Database } from "../migrate.js";
import { departments, memberships, permissionPresets, presetAssignments, users } from "../schema/index.js";
import { uuidv7 } from "../uuid.js";

export type MemberUser = typeof users.$inferSelect;

export async function listTenantUsers(db: Database, tenantId: string): Promise<MemberUser[]> {
  return db.select().from(users).where(eq(users.tenantId, tenantId));
}

export async function getUserById(db: Database, params: { tenantId: string; id: string }): Promise<MemberUser | null> {
  const rows = await db
    .select()
    .from(users)
    .where(and(eq(users.tenantId, params.tenantId), eq(users.id, params.id)))
    .limit(1);
  return rows[0] ?? null;
}

export interface MembershipDepartmentRow {
  userId: string;
  departmentId: string;
  departmentName: string;
}

/**
 * テナント内の全メンバーシップを所属部署名付きで返す(createdAt 降順)。
 * 呼び出し側は同一 userId が複数出現した場合、先頭(最新)のみを採用すること。
 */
export async function listTenantMembershipsWithDepartment(db: Database, tenantId: string): Promise<MembershipDepartmentRow[]> {
  return db
    .select({ userId: memberships.userId, departmentId: memberships.departmentId, departmentName: departments.name })
    .from(memberships)
    .innerJoin(departments, eq(memberships.departmentId, departments.id))
    .where(eq(memberships.tenantId, tenantId))
    .orderBy(desc(memberships.createdAt));
}

export interface AssignedPresetNameRow {
  userId: string;
  presetId: string;
  presetName: string;
}

export async function listTenantAssignedPresetNames(db: Database, tenantId: string): Promise<AssignedPresetNameRow[]> {
  return db
    .select({ userId: presetAssignments.userId, presetId: presetAssignments.presetId, presetName: permissionPresets.name })
    .from(presetAssignments)
    .innerJoin(permissionPresets, eq(presetAssignments.presetId, permissionPresets.id))
    .where(eq(presetAssignments.tenantId, tenantId));
}

export type Membership = typeof memberships.$inferSelect;

export async function getLatestMembership(db: Database, params: { tenantId: string; userId: string }): Promise<Membership | null> {
  const rows = await db
    .select()
    .from(memberships)
    .where(and(eq(memberships.tenantId, params.tenantId), eq(memberships.userId, params.userId)))
    .orderBy(desc(memberships.createdAt))
    .limit(1);
  return rows[0] ?? null;
}

export interface UpsertMembershipInput {
  tenantId: string;
  userId: string;
  departmentId: string;
  createdAt: number;
}

/** 既存のメンバーシップ(最新1行)があれば所属部署を更新、無ければ新規作成する。 */
export async function upsertMembership(db: Database, input: UpsertMembershipInput): Promise<Membership> {
  const existing = await getLatestMembership(db, { tenantId: input.tenantId, userId: input.userId });
  if (existing) {
    const [row] = await db
      .update(memberships)
      .set({ departmentId: input.departmentId })
      .where(eq(memberships.id, existing.id))
      .returning();
    if (!row) {
      throw new Error("upsertMembership: update returned no row");
    }
    return row;
  }
  const [row] = await db
    .insert(memberships)
    .values({
      id: uuidv7(),
      tenantId: input.tenantId,
      userId: input.userId,
      departmentId: input.departmentId,
      createdAt: input.createdAt,
    })
    .returning();
  if (!row) {
    throw new Error("upsertMembership: insert returned no row");
  }
  return row;
}
