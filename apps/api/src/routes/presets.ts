/**
 * GET /presets, GET /presets/catalog, POST /presets, PATCH /presets/:id, DELETE /presets/:id
 * + assignPresetsToMember() — PUT /members/:id/presets(apps/api/src/routes/members.ts）が使う
 *   割当置換ロジック本体。URL 階層は /members 側だが、固定原則の判定ロジックはプリセット
 *   ドメインの関心事としてこのファイルに置く(依頼の section 分けに合わせた判断点)。
 *
 * 権限: 一覧・作成・更新・削除はすべて `permission.preset.manage`(スコープ tenant のみ —
 * docs/design/permission-catalog.md §1.12)で保護する。割当変更のみ `permission.assignment.manage`。
 *
 * 固定原則(docs/requirements.md §4 / 依頼の実装指示):
 * - 自己昇格の禁止: 自分自身への割当変更で、現在持っていない権限(未保持キー、または
 *   より狭いスコープしか持っていなかったキー)を得る場合は 409 self_escalation
 * - 自己降格の禁止: 自分自身への割当変更で `permission.preset.manage` /
 *   `permission.assignment.manage` のいずれかを失う場合は 409 self_demotion
 * - 最後の権限管理保持者の保護: テナント内で `permission.preset.manage` を持つ最後の1人から
 *   その権限を外す操作(対象が自分でも他人でも)は 409 last_admin
 *
 * 判定は「割当変更後の仮の実効権限」を実際に保存する前に計算して行う
 * (apps/api/src/authz.ts の effectivePermissionsFromRawGrantSets を再利用)。
 */

import { Hono } from "hono";
import {
  countPresetAssignments,
  createPreset,
  deletePreset,
  getPresetById,
  insertAuditLog,
  listAssignedPresetGrants,
  listPresets,
  listTenantPresetGrantsByUser,
  replacePresetAssignmentsForUser,
  updatePreset,
  uuidv7,
  type Database,
  type PermissionPreset,
  type RawPermissionGrant,
} from "@kizami/db";
import { PERMISSION_CATALOG, scopeRank } from "@kizami/authz";
import type { Scope } from "@kizami/authz";
import type { AppEnv } from "../auth/middleware.js";
import { effectivePermissionsFromRawGrantSets, requirePermission } from "../authz.js";
import { nowMinutes } from "../lib/time.js";

export const PRESET_MANAGE_PERMISSION = "permission.preset.manage";
export const ASSIGNMENT_MANAGE_PERMISSION = "permission.assignment.manage";

const MAX_NAME_LENGTH = 100;
const MAX_DESCRIPTION_LENGTH = 500;

const CATALOG_MAP = new Map(PERMISSION_CATALOG.map((e) => [e.key, e]));
const VALID_SCOPES: ReadonlySet<Scope> = new Set(["self", "department", "department_and_descendants", "tenant"]);

function serializePreset(p: PermissionPreset) {
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    isSystem: p.isSystem,
    grants: JSON.parse(p.grants) as RawPermissionGrant[],
  };
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

function isValidNameField(value: unknown): value is string {
  return typeof value === "string" && value.trim().length >= 1 && value.length <= MAX_NAME_LENGTH;
}

function isValidDescriptionField(value: unknown): value is string | null {
  if (value === null) return true;
  return typeof value === "string" && value.length <= MAX_DESCRIPTION_LENGTH;
}

type ValidateGrantsResult = { ok: true; grants: RawPermissionGrant[] } | { ok: false };

/**
 * grants[] の各要素({ key, scope })がカタログに実在する権限キー・スコープの組合せかを
 * 検証する(依頼: 「grants の権限キー・スコープがカタログに存在するか検証(不正は400)」)。
 * 同一キーの重複指定も不正として扱う(1プリセット内でスコープが二重定義されるのを防ぐ)。
 */
function validateGrants(value: unknown): ValidateGrantsResult {
  if (!Array.isArray(value)) return { ok: false };

  const grants: RawPermissionGrant[] = [];
  const seenKeys = new Set<string>();
  for (const item of value) {
    if (typeof item !== "object" || item === null) return { ok: false };
    const { key, scope } = item as Record<string, unknown>;
    if (typeof key !== "string" || typeof scope !== "string") return { ok: false };
    if (!VALID_SCOPES.has(scope as Scope)) return { ok: false };

    const catalogEntry = CATALOG_MAP.get(key);
    if (!catalogEntry) return { ok: false };
    if (!catalogEntry.scopes.includes(scope as Scope)) return { ok: false };

    if (seenKeys.has(key)) return { ok: false };
    seenKeys.add(key);

    grants.push({ key, scope });
  }
  return { ok: true, grants };
}

export function createPresetsRoutes(db: Database) {
  const app = new Hono<AppEnv>();

  app.get("/", async (c) => {
    requirePermission(c, PRESET_MANAGE_PERMISSION, "tenant");
    const user = c.get("user");
    const list = await listPresets(db, user.tenantId);
    return c.json({ presets: list.map(serializePreset) });
  });

  // UIがチェックボックスを描くためのカタログ(docs/design/permission-catalog.md §1 の
  // 機械可読な正 — packages/authz/src/catalog.ts の PERMISSION_CATALOG をそのまま返す)。
  app.get("/catalog", async (c) => {
    requirePermission(c, PRESET_MANAGE_PERMISSION, "tenant");
    return c.json({ catalog: PERMISSION_CATALOG });
  });

  app.post("/", async (c) => {
    requirePermission(c, PRESET_MANAGE_PERMISSION, "tenant");
    const user = c.get("user");

    const body = await parseJsonBody(c);
    if (body === null) return c.json({ error: "invalid_body" }, 400);
    if (!isValidNameField(body.name)) return c.json({ error: "invalid_name" }, 400);
    const description = body.description ?? null;
    if (!isValidDescriptionField(description)) return c.json({ error: "invalid_description" }, 400);
    const grantsResult = validateGrants(body.grants);
    if (!grantsResult.ok) return c.json({ error: "invalid_grants" }, 400);

    const now = nowMinutes();
    const created = await createPreset(db, {
      id: uuidv7(),
      tenantId: user.tenantId,
      name: body.name.trim(),
      description,
      grants: JSON.stringify(grantsResult.grants),
      createdAt: now,
    });

    await insertAuditLogForPreset(db, {
      tenantId: user.tenantId,
      actorId: user.id,
      action: "permission_preset.create",
      presetId: created.id,
      detail: { name: created.name, description: created.description, grants: grantsResult.grants },
      now,
    });

    return c.json({ preset: serializePreset(created) }, 201);
  });

  app.patch("/:id", async (c) => {
    requirePermission(c, PRESET_MANAGE_PERMISSION, "tenant");
    const user = c.get("user");
    const id = c.req.param("id");

    const existing = await getPresetById(db, { tenantId: user.tenantId, id });
    if (!existing) return c.json({ error: "not_found" }, 404);
    if (existing.isSystem) return c.json({ error: "system_preset" }, 409);

    const body = await parseJsonBody(c);
    if (body === null) return c.json({ error: "invalid_body" }, 400);

    const updates: { name?: string; description?: string | null; grants?: string } = {};

    if (body.name !== undefined) {
      if (!isValidNameField(body.name)) return c.json({ error: "invalid_name" }, 400);
      updates.name = body.name.trim();
    }
    if (body.description !== undefined) {
      if (!isValidDescriptionField(body.description)) return c.json({ error: "invalid_description" }, 400);
      updates.description = body.description;
    }
    if (body.grants !== undefined) {
      const grantsResult = validateGrants(body.grants);
      if (!grantsResult.ok) return c.json({ error: "invalid_grants" }, 400);
      updates.grants = JSON.stringify(grantsResult.grants);
    }

    const updated = await updatePreset(db, { id: existing.id, tenantId: user.tenantId, ...updates });
    if (!updated) return c.json({ error: "not_found" }, 404);

    const now = nowMinutes();
    await insertAuditLogForPreset(db, {
      tenantId: user.tenantId,
      actorId: user.id,
      action: "permission_preset.update",
      presetId: updated.id,
      detail: {
        before: { name: existing.name, description: existing.description, grants: JSON.parse(existing.grants) as unknown },
        after: { name: updated.name, description: updated.description, grants: JSON.parse(updated.grants) as unknown },
      },
      now,
    });

    return c.json({ preset: serializePreset(updated) });
  });

  app.delete("/:id", async (c) => {
    requirePermission(c, PRESET_MANAGE_PERMISSION, "tenant");
    const user = c.get("user");
    const id = c.req.param("id");

    const existing = await getPresetById(db, { tenantId: user.tenantId, id });
    if (!existing) return c.json({ error: "not_found" }, 404);
    if (existing.isSystem) return c.json({ error: "system_preset" }, 409);

    const assignmentCount = await countPresetAssignments(db, { tenantId: user.tenantId, presetId: id });
    if (assignmentCount > 0) return c.json({ error: "preset_in_use" }, 409);

    await deletePreset(db, { tenantId: user.tenantId, id });

    const now = nowMinutes();
    await insertAuditLogForPreset(db, {
      tenantId: user.tenantId,
      actorId: user.id,
      action: "permission_preset.delete",
      presetId: id,
      detail: { name: existing.name },
      now,
    });

    return c.json({ ok: true });
  });

  return app;
}

async function insertAuditLogForPreset(
  db: Database,
  params: { tenantId: string; actorId: string; action: string; presetId: string; detail: unknown; now: number },
): Promise<void> {
  await insertAuditLog(db, {
    tenantId: params.tenantId,
    actorId: params.actorId,
    action: params.action,
    targetType: "permission_preset",
    targetId: params.presetId,
    detail: JSON.stringify(params.detail),
    occurredAt: params.now,
  });
}

// --- PUT /members/:id/presets の実体(members.ts から呼ばれる) -----------------------------

export interface AssignPresetsParams {
  db: Database;
  actor: { id: string; tenantId: string };
  targetUserId: string;
  presetIds: string[];
}

export type AssignPresetsResult =
  | { ok: true; presetIds: string[]; presetNames: string[] }
  | { ok: false; status: 400 | 409; error: string };

/**
 * あるユーザーへのプリセット割当を丸ごと置き換える。固定原則(自己昇格・自己降格・
 * 最後の権限管理保持者保護)をここで検証してから DB へ反映する。
 */
export async function assignPresetsToMember(params: AssignPresetsParams): Promise<AssignPresetsResult> {
  const { db, actor, targetUserId, presetIds: rawPresetIds } = params;
  const presetIds = Array.from(new Set(rawPresetIds));

  const presets: PermissionPreset[] = [];
  for (const presetId of presetIds) {
    const preset = await getPresetById(db, { tenantId: actor.tenantId, id: presetId });
    if (!preset) return { ok: false, status: 400, error: "invalid_preset_id" };
    presets.push(preset);
  }

  const beforeRawGrantSets = await listAssignedPresetGrants(db, { tenantId: actor.tenantId, userId: targetUserId });
  const afterRawGrantSets: RawPermissionGrant[][] = presets.map((p) => JSON.parse(p.grants) as RawPermissionGrant[]);

  const beforeEffective = effectivePermissionsFromRawGrantSets(beforeRawGrantSets);
  const afterEffective = effectivePermissionsFromRawGrantSets(afterRawGrantSets);

  const isSelf = targetUserId === actor.id;

  if (isSelf) {
    // 固定原則: 自己昇格の禁止 — 割当変更後に、変更前は持っていなかった権限
    // (未保持キー、またはより狭いスコープしか持っていなかったキー)を得る操作は不可
    for (const [key, afterScope] of afterEffective) {
      const beforeScope = beforeEffective.get(key);
      if (beforeScope === undefined || scopeRank(afterScope) > scopeRank(beforeScope)) {
        return { ok: false, status: 409, error: "self_escalation" };
      }
    }

    // 固定原則: 自己降格の禁止 — permission.preset.manage / permission.assignment.manage の
    // いずれかを、割当変更によって自分自身から失う操作は不可
    for (const key of [PRESET_MANAGE_PERMISSION, ASSIGNMENT_MANAGE_PERMISSION]) {
      if (beforeEffective.has(key) && !afterEffective.has(key)) {
        return { ok: false, status: 409, error: "self_demotion" };
      }
    }
  }

  // 固定原則: 最後の「権限管理」保持者の保護(対象が自分でも他人でも適用する)
  const heldPresetManageBefore = beforeEffective.has(PRESET_MANAGE_PERMISSION);
  const holdsPresetManageAfter = afterEffective.has(PRESET_MANAGE_PERMISSION);
  if (heldPresetManageBefore && !holdsPresetManageAfter) {
    const allGrantsByUser = await listTenantPresetGrantsByUser(db, actor.tenantId);
    let otherHolders = 0;
    for (const [userId, rawGrantSets] of allGrantsByUser) {
      if (userId === targetUserId) continue;
      const effective = effectivePermissionsFromRawGrantSets(rawGrantSets);
      if (effective.has(PRESET_MANAGE_PERMISSION)) otherHolders++;
    }
    if (otherHolders === 0) {
      return { ok: false, status: 409, error: "last_admin" };
    }
  }

  await replacePresetAssignmentsForUser(db, {
    tenantId: actor.tenantId,
    userId: targetUserId,
    presetIds,
    createdAt: nowMinutes(),
  });

  return { ok: true, presetIds, presetNames: presets.map((p) => p.name) };
}
