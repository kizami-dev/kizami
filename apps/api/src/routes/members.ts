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
 * スコープの粒度: requirePermission は「保持スコープが最低限 department 以上か」までしか
 * 見ないため、対象メンバーが実際に actor の管轄下(所属部署・その配下)にいるかは
 * apps/api/src/lib/scope.ts の resolveAccessibleUserIds() で別途絞り込む
 * (以前はここが未実装で、department_and_descendants しか持たないユーザーでも
 * テナント全体を操作できてしまっていた)。
 */

import { Hono } from "hono";
import {
  getDepartmentById,
  getUserById,
  insertAuditLog,
  listTenantAssignedPresetNames,
  listTenantMembershipsWithDepartment,
  listTenantUsers,
  updateUserHireDate,
  upsertMembership,
  type Database,
} from "@kizami/db";
import type { AppEnv } from "../auth/middleware.js";
import { ForbiddenError, requirePermission } from "../authz.js";
import { resolveAccessibleUserIds } from "../lib/scope.js";
import { nowMinutes } from "../lib/time.js";
import { ASSIGNMENT_MANAGE_PERMISSION, assignPresetsToMember } from "./presets.js";

const VIEW_PERMISSION = "member.view";
const EDIT_PERMISSION = "member.profile.edit";

/** "YYYY-MM-DD" の書式チェックのみ(既存 routes/leave.ts の DATE_RE と同じ流儀)。 */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

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

    const accessibleUserIds = await resolveAccessibleUserIds(db, {
      actor: { id: user.id, tenantId: user.tenantId, permissions: c.get("permissions") },
      permission: VIEW_PERMISSION,
    });

    const [tenantUsers, membershipRows, presetNameRows] = await Promise.all([
      listTenantUsers(db, user.tenantId),
      listTenantMembershipsWithDepartment(db, user.tenantId),
      listTenantAssignedPresetNames(db, user.tenantId),
    ]);
    const allUsers = accessibleUserIds === "all" ? tenantUsers : tenantUsers.filter((u) => accessibleUserIds.has(u.id));

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
        // 入社日(2026-08-22 追加)。法定付与の計算に使う(routes/leave.ts の
        // POST /leave/grants/auto)。null = 未設定 → 法定付与ができない(画面側で警告表示)。
        hireDate: u.hireDate,
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

    // 404(存在しない)を先に判定してから、実在する対象がスコープ外かを判定する
    // (対象の有無を先に漏らさない一般的な優先順位に加え、既存テストの404期待とも整合する)。
    const accessibleUserIds = await resolveAccessibleUserIds(db, {
      actor: { id: user.id, tenantId: user.tenantId, permissions: c.get("permissions") },
      permission: EDIT_PERMISSION,
    });
    if (accessibleUserIds !== "all" && !accessibleUserIds.has(id)) {
      throw new ForbiddenError(`target user ${id} is outside actor's scope`);
    }

    const body = await parseJsonBody(c);
    if (body === null) return c.json({ error: "invalid_body" }, 400);
    // 対応フィールド: departmentId(所属変更、v0.2) / hireDate(入社日、2026-08-22 追加)。
    // どちらも省略可能な PATCH(部分更新)だが、両方省略は無効なリクエストとして拒否する。
    if (body.departmentId === undefined && body.hireDate === undefined) {
      return c.json({ error: "invalid_body" }, 400);
    }

    let departmentId: string | undefined;
    if (body.departmentId !== undefined) {
      if (typeof body.departmentId !== "string") {
        return c.json({ error: "invalid_department_id" }, 400);
      }
      const department = await getDepartmentById(db, { tenantId: user.tenantId, id: body.departmentId });
      if (!department) return c.json({ error: "invalid_department_id" }, 400);
      departmentId = department.id;
    }

    let hireDate: string | null | undefined;
    if (body.hireDate !== undefined) {
      if (body.hireDate === null) {
        hireDate = null;
      } else if (typeof body.hireDate === "string" && DATE_RE.test(body.hireDate)) {
        hireDate = body.hireDate;
      } else {
        return c.json({ error: "invalid_hire_date" }, 400);
      }
    }

    const now = nowMinutes();
    if (departmentId !== undefined) {
      await upsertMembership(db, { tenantId: user.tenantId, userId: target.id, departmentId, createdAt: now });
    }
    if (hireDate !== undefined) {
      await updateUserHireDate(db, { tenantId: user.tenantId, userId: target.id, hireDate });
    }

    await insertAuditLog(db, {
      tenantId: user.tenantId,
      actorId: user.id,
      action: "member.update",
      targetType: "user",
      targetId: target.id,
      detail: JSON.stringify({ ...(departmentId !== undefined ? { departmentId } : {}), ...(hireDate !== undefined ? { hireDate } : {}) }),
      occurredAt: now,
    });

    return c.json({
      member: {
        id: target.id,
        ...(departmentId !== undefined ? { departmentId } : {}),
        ...(hireDate !== undefined ? { hireDate } : {}),
      },
    });
  });

  app.put("/:id/presets", async (c) => {
    requirePermission(c, ASSIGNMENT_MANAGE_PERMISSION, "department");
    const actor = c.get("user");
    const targetId = c.req.param("id");

    const target = await getUserById(db, { tenantId: actor.tenantId, id: targetId });
    if (!target) return c.json({ error: "not_found" }, 404);

    const accessibleUserIds = await resolveAccessibleUserIds(db, {
      actor: { id: actor.id, tenantId: actor.tenantId, permissions: c.get("permissions") },
      permission: ASSIGNMENT_MANAGE_PERMISSION,
    });
    if (accessibleUserIds !== "all" && !accessibleUserIds.has(targetId)) {
      throw new ForbiddenError(`target user ${targetId} is outside actor's scope`);
    }

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
