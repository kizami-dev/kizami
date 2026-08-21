/**
 * GET /departments, POST /departments, PATCH /departments/:id, DELETE /departments/:id
 *
 * 部署ツリー(departments)の管理API。参照: docs/design/permission-catalog.md §1.9
 * (`department.manage`、適用スコープ 自部署+配下部署 / テナント全体)。
 *
 * 判断点(スコープの粒度): department.manage は「自部署+配下部署」スコープでも許可されるが、
 * 「操作対象の部署が実際に actor 自身の部署の配下か」という resource 単位の絞り込みは、
 * このコードベースの既存ルート(routes/settings.ts 等)がまだ一切実装していない
 * (既存は全て tenant スコープ固定、または requireSelf のコース粒度のみ)。今回もその前例に
 * 倣い、`department.manage` を department_and_descendants 以上のスコープで保持していれば
 * テナント内の任意の部署を操作できる、という粗い粒度で実装した。部署ツリー全体を
 * 対象部署の配下に限定する厳密なチェックは v0.2 の別課題として残す(要レビュー)。
 *
 * 判断点(閲覧の権限): 依頼に基づき、`department.manage` 保持者に加えて `member.view`
 * 保持者にも閲覧を許可する。部署ツリーは他画面(メンバー一覧・所属変更UI等)の土台データで、
 * 部署管理権限は無くても自部署メンバーの閲覧権限(member.view)を持つマネージャー等が
 * 所属選択肢を組み立てるために必要になるため。カタログ上 member.view は department 閲覧を
 * 含意しないが、実用上どちらか一方で足りると判断した。
 */

import { Hono } from "hono";
import {
  countChildDepartments,
  countMembershipsInDepartment,
  createDepartment,
  deleteDepartment,
  getDepartmentById,
  insertAuditLog,
  listDepartments,
  updateDepartment,
  uuidv7,
  type Database,
  type Department,
} from "@kizami/db";
import { hasPermission } from "@kizami/authz";
import type { Context } from "hono";
import type { AppEnv } from "../auth/middleware.js";
import { ForbiddenError, requirePermission } from "../authz.js";
import { nowMinutes } from "../lib/time.js";

const MANAGE_PERMISSION = "department.manage";
const VIEW_FALLBACK_PERMISSION = "member.view";
const MAX_NAME_LENGTH = 200;

function serialize(d: Department) {
  return { id: d.id, name: d.name, parentId: d.parentId, createdAt: d.createdAt };
}

function canView(c: Context<AppEnv>): boolean {
  const permissions = c.get("permissions");
  return (
    hasPermission(permissions, MANAGE_PERMISSION, "department_and_descendants") ||
    hasPermission(permissions, VIEW_FALLBACK_PERMISSION, "department")
  );
}

async function parseJsonBody(c: { req: { json: () => Promise<unknown> } }): Promise<Record<string, unknown> | null> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return null;
  }
  if (typeof body !== "object" || body === null) return null;
  return body as Record<string, unknown>;
}

function isValidName(value: unknown): value is string {
  return typeof value === "string" && value.trim().length >= 1 && value.length <= MAX_NAME_LENGTH;
}

/**
 * `candidateId` が `rootId` 自身、または `rootId` の子孫かどうかを判定する
 * (parentId 更新時の循環参照防止に使う: 新しい親候補が自分自身または自分の子孫なら不可)。
 */
function isSelfOrDescendant(all: Department[], rootId: string, candidateId: string): boolean {
  if (rootId === candidateId) return true;

  const childrenByParent = new Map<string, string[]>();
  for (const d of all) {
    if (d.parentId === null) continue;
    const list = childrenByParent.get(d.parentId) ?? [];
    list.push(d.id);
    childrenByParent.set(d.parentId, list);
  }

  const stack = [...(childrenByParent.get(rootId) ?? [])];
  while (stack.length > 0) {
    const current = stack.pop() as string;
    if (current === candidateId) return true;
    stack.push(...(childrenByParent.get(current) ?? []));
  }
  return false;
}

export function createDepartmentsRoutes(db: Database) {
  const app = new Hono<AppEnv>();

  app.get("/", async (c) => {
    if (!canView(c)) {
      throw new ForbiddenError(`missing permission: ${MANAGE_PERMISSION} or ${VIEW_FALLBACK_PERMISSION}`);
    }
    const user = c.get("user");
    const list = await listDepartments(db, user.tenantId);
    return c.json({ departments: list.map(serialize) });
  });

  app.post("/", async (c) => {
    requirePermission(c, MANAGE_PERMISSION, "department_and_descendants");
    const user = c.get("user");

    const body = await parseJsonBody(c);
    if (body === null) return c.json({ error: "invalid_body" }, 400);
    if (!isValidName(body.name)) return c.json({ error: "invalid_name" }, 400);

    let parentId: string | null = null;
    if (body.parentId !== undefined && body.parentId !== null) {
      if (typeof body.parentId !== "string") return c.json({ error: "invalid_parent_id" }, 400);
      const parent = await getDepartmentById(db, { tenantId: user.tenantId, id: body.parentId });
      if (!parent) return c.json({ error: "invalid_parent_id" }, 400);
      parentId = parent.id;
    }

    const now = nowMinutes();
    const created = await createDepartment(db, {
      id: uuidv7(),
      tenantId: user.tenantId,
      name: body.name.trim(),
      parentId,
      createdAt: now,
    });

    await insertAuditLog(db, {
      tenantId: user.tenantId,
      actorId: user.id,
      action: "department.create",
      targetType: "department",
      targetId: created.id,
      detail: JSON.stringify({ name: created.name, parentId: created.parentId }),
      occurredAt: now,
    });

    return c.json({ department: serialize(created) }, 201);
  });

  app.patch("/:id", async (c) => {
    requirePermission(c, MANAGE_PERMISSION, "department_and_descendants");
    const user = c.get("user");
    const id = c.req.param("id");

    const existing = await getDepartmentById(db, { tenantId: user.tenantId, id });
    if (!existing) return c.json({ error: "not_found" }, 404);

    const body = await parseJsonBody(c);
    if (body === null) return c.json({ error: "invalid_body" }, 400);

    const updates: { name?: string; parentId?: string | null } = {};

    if (body.name !== undefined) {
      if (!isValidName(body.name)) return c.json({ error: "invalid_name" }, 400);
      updates.name = body.name.trim();
    }

    if (body.parentId !== undefined) {
      if (body.parentId === null) {
        updates.parentId = null;
      } else {
        if (typeof body.parentId !== "string") return c.json({ error: "invalid_parent_id" }, 400);
        const newParent = await getDepartmentById(db, { tenantId: user.tenantId, id: body.parentId });
        if (!newParent) return c.json({ error: "invalid_parent_id" }, 400);

        // 循環参照の防止: 自分自身、または自分の子孫を親にはできない
        const all = await listDepartments(db, user.tenantId);
        if (isSelfOrDescendant(all, existing.id, newParent.id)) {
          return c.json({ error: "circular_reference" }, 400);
        }
        updates.parentId = newParent.id;
      }
    }

    if (Object.keys(updates).length === 0) {
      return c.json({ department: serialize(existing) });
    }

    const updated = await updateDepartment(db, { id: existing.id, tenantId: user.tenantId, ...updates });
    if (!updated) return c.json({ error: "not_found" }, 404);

    const now = nowMinutes();
    await insertAuditLog(db, {
      tenantId: user.tenantId,
      actorId: user.id,
      action: "department.update",
      targetType: "department",
      targetId: updated.id,
      detail: JSON.stringify({
        before: { name: existing.name, parentId: existing.parentId },
        after: { name: updated.name, parentId: updated.parentId },
      }),
      occurredAt: now,
    });

    return c.json({ department: serialize(updated) });
  });

  app.delete("/:id", async (c) => {
    requirePermission(c, MANAGE_PERMISSION, "department_and_descendants");
    const user = c.get("user");
    const id = c.req.param("id");

    const existing = await getDepartmentById(db, { tenantId: user.tenantId, id });
    if (!existing) return c.json({ error: "not_found" }, 404);

    const [childCount, memberCount] = await Promise.all([
      countChildDepartments(db, { tenantId: user.tenantId, parentId: id }),
      countMembershipsInDepartment(db, { tenantId: user.tenantId, departmentId: id }),
    ]);
    if (childCount > 0 || memberCount > 0) {
      return c.json({ error: "department_not_empty" }, 409);
    }

    await deleteDepartment(db, { tenantId: user.tenantId, id });

    const now = nowMinutes();
    await insertAuditLog(db, {
      tenantId: user.tenantId,
      actorId: user.id,
      action: "department.delete",
      targetType: "department",
      targetId: id,
      detail: JSON.stringify({ name: existing.name, parentId: existing.parentId }),
      occurredAt: now,
    });

    return c.json({ ok: true });
  });

  return app;
}
