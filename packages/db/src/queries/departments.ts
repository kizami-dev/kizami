/**
 * departments(部署ツリー)への CRUD クエリ。
 *
 * 循環参照の検証(親を自分自身・自分の子孫にできない)や削除時の「空かどうか」判定は
 * 呼び出し側(apps/api/src/routes/departments.ts)の責務とする。ここでは
 * `listDepartments` で全件を返し、木の走査はアプリ層に委ねる(テナントあたりの部署数は
 * v0.1 では小規模想定のため全件ロードで十分)。
 */

import { and, eq } from "drizzle-orm";
import type { Database } from "../types.js";
import { departments, memberships } from "../schema/index.js";

export type Department = typeof departments.$inferSelect;

/** テナント内の全部署をフラット配列で返す(parentId を含む。木の組み立てはアプリ層)。 */
export async function listDepartments(db: Database, tenantId: string): Promise<Department[]> {
  return db.select().from(departments).where(eq(departments.tenantId, tenantId));
}

export async function getDepartmentById(db: Database, params: { tenantId: string; id: string }): Promise<Department | null> {
  const rows = await db
    .select()
    .from(departments)
    .where(and(eq(departments.tenantId, params.tenantId), eq(departments.id, params.id)))
    .limit(1);
  return rows[0] ?? null;
}

export interface CreateDepartmentInput {
  id: string;
  tenantId: string;
  name: string;
  parentId: string | null;
  createdAt: number;
}

export async function createDepartment(db: Database, input: CreateDepartmentInput): Promise<Department> {
  const [row] = await db.insert(departments).values(input).returning();
  if (!row) {
    throw new Error("createDepartment: insert returned no row");
  }
  return row;
}

export interface UpdateDepartmentInput {
  id: string;
  tenantId: string;
  name?: string;
  parentId?: string | null;
}

/** name/parentId のうち渡されたフィールドのみ更新する(undefined は「変更しない」の意)。 */
export async function updateDepartment(db: Database, input: UpdateDepartmentInput): Promise<Department | null> {
  const { id, tenantId, ...rest } = input;
  const setValues: Partial<typeof departments.$inferInsert> = {};
  if (rest.name !== undefined) setValues.name = rest.name;
  if (rest.parentId !== undefined) setValues.parentId = rest.parentId;

  if (Object.keys(setValues).length === 0) {
    return getDepartmentById(db, { tenantId, id });
  }

  const [row] = await db
    .update(departments)
    .set(setValues)
    .where(and(eq(departments.tenantId, tenantId), eq(departments.id, id)))
    .returning();
  return row ?? null;
}

/** 削除する。呼び出し側が事前に子部署・所属メンバーの有無(409対象)を検証していること。 */
export async function deleteDepartment(db: Database, params: { tenantId: string; id: string }): Promise<boolean> {
  const result = await db
    .delete(departments)
    .where(and(eq(departments.tenantId, params.tenantId), eq(departments.id, params.id)))
    .returning({ id: departments.id });
  return result.length > 0;
}

/** 直接の子部署数(削除時の 409 department_not_empty 判定用)。 */
export async function countChildDepartments(db: Database, params: { tenantId: string; parentId: string }): Promise<number> {
  const rows = await db
    .select({ id: departments.id })
    .from(departments)
    .where(and(eq(departments.tenantId, params.tenantId), eq(departments.parentId, params.parentId)));
  return rows.length;
}

/** 直接その部署に所属するメンバーシップ数(削除時の 409 department_not_empty 判定用)。 */
export async function countMembershipsInDepartment(
  db: Database,
  params: { tenantId: string; departmentId: string },
): Promise<number> {
  const rows = await db
    .select({ id: memberships.id })
    .from(memberships)
    .where(and(eq(memberships.tenantId, params.tenantId), eq(memberships.departmentId, params.departmentId)));
  return rows.length;
}
