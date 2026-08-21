/**
 * GET /members, PATCH /members/:id, PUT /members/:id/presets
 *
 * メンバー一覧・所属変更・プリセット割当のAPI。参照: docs/design/permission-catalog.md
 * §1.8(メンバー管理)、§1.12(権限管理)。
 *
 * 権限: 一覧閲覧は `member.view`、所属(departmentId)の変更は `member.profile.edit`。
 * プリセット割当(PUT /:id/presets)は `permission.assignment.manage` — 実際の検証・
 * 固定原則(自己昇格/自己降格/最後の権限管理保持者保護)の判定は routes/presets.ts の
 * `assignPresetsToMember()` に委譲する(依頼の section 分けでは C. presets.ts の管轄だが、
 * URL は /members/:id/presets にネストするため、ハンドラ自体はこのファイルに置く)。
 *
 * 判断点(スコープの粒度): routes/departments.ts と同じ理由により、対象メンバーが
 * actor 自身の部署配下かという resource 単位の絞り込みは行わず、要求スコープ(department)
 * 以上を持っていればテナント内の任意メンバーを一覧・編集できる粗い粒度で実装した。
 */

import { Hono } from "hono";
import {
  getDepartmentById,
  getUserById,
  insertAuditLog,
  listTenantAssignedPresetNames,
  listTenantMembershipsWithDepartment,
  listTenantUsers,
  upsertMembership,
  type Database,
} from "@kizami/db";
import type { AppEnv } from "../auth/middleware.js";
import { requirePermission } from "../authz.js";
import { nowMinutes } from "../lib/time.js";
import { ASSIGNMENT_MANAGE_PERMISSION, assignPresetsToMember } from "./presets.js";

const VIEW_PERMISSION = "member.view";
const EDIT_PERMISSION = "member.profile.edit";

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

export function createMembersRoutes(db: Database) {
  const app = new Hono<AppEnv>();

  app.get("/", async (c) => {
    requirePermission(c, VIEW_PERMISSION, "department");
    const user = c.get("user");

    const [allUsers, membershipRows, presetNameRows] = await Promise.all([
      listTenantUsers(db, user.tenantId),
      listTenantMembershipsWithDepartment(db, user.tenantId),
      listTenantAssignedPresetNames(db, user.tenantId),
    ]);

    // membershipRows は createdAt 降順。1ユーザーに複数行あり得るため最初に出現した
    // (=最新の)行だけを採用する(packages/db/src/queries/members.ts の規約)。
    const departmentByUser = new Map<string, { id: string; name: string }>();
    for (const m of membershipRows) {
      if (!departmentByUser.has(m.userId)) {
        departmentByUser.set(m.userId, { id: m.departmentId, name: m.departmentName });
      }
    }

    const presetNamesByUser = new Map<string, string[]>();
    for (const p of presetNameRows) {
      const list = presetNamesByUser.get(p.userId) ?? [];
      list.push(p.presetName);
      presetNamesByUser.set(p.userId, list);
    }

    return c.json({
      members: allUsers.map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        isActive: u.isActive,
        department: departmentByUser.get(u.id) ?? null,
        presetNames: presetNamesByUser.get(u.id) ?? [],
      })),
    });
  });

  app.patch("/:id", async (c) => {
    requirePermission(c, EDIT_PERMISSION, "department");
    const user = c.get("user");
    const id = c.req.param("id");

    const target = await getUserById(db, { tenantId: user.tenantId, id });
    if (!target) return c.json({ error: "not_found" }, 404);

    const body = await parseJsonBody(c);
    if (body === null) return c.json({ error: "invalid_body" }, 400);
    if (body.departmentId === undefined) {
      // v0.2 では所属変更のみサポート(依頼の範囲: {departmentId?})
      return c.json({ error: "invalid_body" }, 400);
    }
    if (typeof body.departmentId !== "string") {
      return c.json({ error: "invalid_department_id" }, 400);
    }

    const department = await getDepartmentById(db, { tenantId: user.tenantId, id: body.departmentId });
    if (!department) return c.json({ error: "invalid_department_id" }, 400);

    const now = nowMinutes();
    await upsertMembership(db, { tenantId: user.tenantId, userId: target.id, departmentId: department.id, createdAt: now });

    await insertAuditLog(db, {
      tenantId: user.tenantId,
      actorId: user.id,
      action: "member.update",
      targetType: "user",
      targetId: target.id,
      detail: JSON.stringify({ departmentId: department.id }),
      occurredAt: now,
    });

    return c.json({ member: { id: target.id, departmentId: department.id } });
  });

  app.put("/:id/presets", async (c) => {
    requirePermission(c, ASSIGNMENT_MANAGE_PERMISSION, "department");
    const actor = c.get("user");
    const targetId = c.req.param("id");

    const target = await getUserById(db, { tenantId: actor.tenantId, id: targetId });
    if (!target) return c.json({ error: "not_found" }, 404);

    const body = await parseJsonBody(c);
    if (
      body === null ||
      !Array.isArray(body.presetIds) ||
      !body.presetIds.every((v): v is string => typeof v === "string")
    ) {
      return c.json({ error: "invalid_body" }, 400);
    }

    const result = await assignPresetsToMember({
      db,
      actor: { id: actor.id, tenantId: actor.tenantId },
      targetUserId: target.id,
      presetIds: body.presetIds,
    });
    if (!result.ok) {
      return c.json({ error: result.error }, result.status);
    }

    await insertAuditLog(db, {
      tenantId: actor.tenantId,
      actorId: actor.id,
      action: "permission_assignment.update",
      targetType: "user",
      targetId: target.id,
      detail: JSON.stringify({ presetIds: result.presetIds, presetNames: result.presetNames }),
      occurredAt: nowMinutes(),
    });

    return c.json({ presetIds: result.presetIds });
  });

  return app;
}
