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
 *   その権限を外す操作(対象が自分でも他人でも)は 409 last_admin。**割当変更だけでなく
 *   プリセットの編集(PATCH /presets/:id)にも適用する** — 拒否ルール(deny)の導入により、
 *   プリセットに `permission.preset.manage` の deny を1つ足すだけで、割当を一切触らずに
 *   テナントから権限管理者を消せてしまうため(2026-08-24)
 *
 * 拒否ルール(deny、2026-08-24): プリセットは grants と別に denies(権限キーの配列・
 * スコープなし)を持てる。実効権限は「全プリセットの grants の union − 全プリセットの
 * denies の union」。詳細は docs/design/permission-catalog.md §拒否(deny)ルール。
 *
 * 判定は「割当変更後・編集後の仮の実効権限」を実際に保存する前に計算して行う
 * (apps/api/src/authz.ts の effectivePermissionsFromPresets を再利用)。
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
  listTenantPresetAssignmentRows,
  listTenantPresetGrantsByUser,
  replacePresetAssignmentsForUser,
  updatePreset,
  uuidv7,
  type Database,
  type PermissionPreset,
  type RawPermissionGrant,
  type RawPresetPermissions,
} from "@kizami/db";
import { PERMISSION_CATALOG, scopeRank } from "@kizami/authz";
import type { Scope } from "@kizami/authz";
import type { AppEnv } from "../auth/middleware.js";
import { effectivePermissionsFromPresets, requirePermission } from "../authz.js";
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
    /** 拒否する権限キー(スコープなし)。deny 未使用のプリセットでは常に空配列。 */
    denies: JSON.parse(p.denies) as string[],
  };
}

/** プリセット行(DB)を実効権限計算の入力へ変換する。 */
function presetPermissionsOf(p: PermissionPreset): RawPresetPermissions {
  return { grants: JSON.parse(p.grants) as RawPermissionGrant[], denies: JSON.parse(p.denies) as string[] };
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

type ValidateDeniesResult = { ok: true; denies: string[] } | { ok: false };

/**
 * denies[] の各要素(権限キーの文字列)がカタログに実在するかを検証する。
 * **deny はスコープを持たない**(全スコープでの全面的な拒否)ため、grants と違い
 * scope の検証は無い — 理由は packages/authz/src/types.ts の Deny 型のコメント参照。
 *
 * セルフサービス権限(自分の打刻等)はそもそもカタログに含まれないため、ここで自動的に
 * 弾かれる(評価器側でも UNDENIABLE_PERMISSIONS で二重に守っている)。
 * 同一キーの重複指定も不正として扱う。
 */
function validateDenies(value: unknown): ValidateDeniesResult {
  if (!Array.isArray(value)) return { ok: false };

  const denies: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string") return { ok: false };
    if (!CATALOG_MAP.has(item)) return { ok: false };
    if (seen.has(item)) return { ok: false };
    seen.add(item);
    denies.push(item);
  }
  return { ok: true, denies };
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
    // denies は省略可(未指定 = 拒否なし)。既存クライアントとの後方互換のため必須にしない。
    const deniesResult = validateDenies(body.denies ?? []);
    if (!deniesResult.ok) return c.json({ error: "invalid_denies" }, 400);

    const now = nowMinutes();
    const created = await createPreset(db, {
      id: uuidv7(),
      tenantId: user.tenantId,
      name: body.name.trim(),
      description,
      grants: JSON.stringify(grantsResult.grants),
      denies: JSON.stringify(deniesResult.denies),
      createdAt: now,
    });

    await insertAuditLogForPreset(db, {
      tenantId: user.tenantId,
      actorId: user.id,
      action: "permission_preset.create",
      presetId: created.id,
      detail: {
        name: created.name,
        description: created.description,
        grants: grantsResult.grants,
        denies: deniesResult.denies,
      },
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

    const updates: { name?: string; description?: string | null; grants?: string; denies?: string } = {};

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
    if (body.denies !== undefined) {
      const deniesResult = validateDenies(body.denies);
      if (!deniesResult.ok) return c.json({ error: "invalid_denies" }, 400);
      updates.denies = JSON.stringify(deniesResult.denies);
    }

    // 固定原則: 最後の「権限管理」保持者の保護。grants を削る編集でも deny を足す編集でも、
    // 保存後にテナントから permission.preset.manage 保持者が0人になるなら拒否する。
    if (updates.grants !== undefined || updates.denies !== undefined) {
      const guard = await guardLastPresetManageHolder(db, {
        tenantId: user.tenantId,
        presetId: existing.id,
        next: {
          grants: JSON.parse(updates.grants ?? existing.grants) as RawPermissionGrant[],
          denies: JSON.parse(updates.denies ?? existing.denies) as string[],
        },
      });
      if (!guard.ok) return c.json({ error: guard.error }, 409);
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
        before: {
          name: existing.name,
          description: existing.description,
          grants: JSON.parse(existing.grants) as unknown,
          denies: JSON.parse(existing.denies) as unknown,
        },
        after: {
          name: updated.name,
          description: updated.description,
          grants: JSON.parse(updated.grants) as unknown,
          denies: JSON.parse(updated.denies) as unknown,
        },
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

/**
 * 固定原則: 最後の「権限管理」保持者の保護 — **プリセット編集版**(2026-08-24、deny 導入に伴い追加)。
 *
 * 割当変更版(assignPresetsToMember)は「対象ユーザー1人の実効権限が変わる」前提だが、
 * プリセットの編集はそのプリセットを割り当てられた**全ユーザー**の実効権限を一斉に変える。
 * 特に deny は他プリセットの付与も打ち消すため、たった1つの deny 追加でテナント内の
 * `permission.preset.manage` 保持者を0人にできてしまう(誰も権限プリセットを編集できなくなり、
 * DB を直接触る以外の回復手段が無くなる)。そこで保存前に、編集後の内容でテナント全ユーザーの
 * 実効権限を計算し直し、保持者が0人になるなら 409 last_admin で拒否する。
 *
 * 「編集前は1人以上いたが編集後は0人」だけを拒否する(編集前から0人の異常なテナントでは、
 * この編集がその状態を悪化させたわけではないため通す — 別の経路で回復してもらう)。
 */
async function guardLastPresetManageHolder(
  db: Database,
  params: { tenantId: string; presetId: string; next: RawPresetPermissions },
): Promise<{ ok: true } | { ok: false; error: "last_admin" }> {
  const presetsByUser = await listTenantPresetPermissionsByUserWithOverride(db, params);

  let holdersBefore = 0;
  let holdersAfter = 0;
  for (const { before, after } of presetsByUser.values()) {
    if (effectivePermissionsFromPresets(before).has(PRESET_MANAGE_PERMISSION)) holdersBefore++;
    if (effectivePermissionsFromPresets(after).has(PRESET_MANAGE_PERMISSION)) holdersAfter++;
  }

  if (holdersBefore > 0 && holdersAfter === 0) return { ok: false, error: "last_admin" };
  return { ok: true };
}

/**
 * テナント全ユーザーについて「現在の割当プリセット群」と「対象プリセットだけ編集後の内容へ
 * 差し替えた場合の割当プリセット群」の両方を返す。
 *
 * listTenantPresetGrantsByUser は preset の内容しか返さない(どの preset 由来かが分からない)
 * ため、ここでは割当を presetId 付きで読み直す代わりに、編集対象プリセットの「編集前の内容」と
 * 一致する要素を差し替える…のではなく、割当を直接引き直して確実に対応付ける(判断点:
 * 内容一致による差し替えは同一内容の別プリセットを取り違えるため)。
 */
async function listTenantPresetPermissionsByUserWithOverride(
  db: Database,
  params: { tenantId: string; presetId: string; next: RawPresetPermissions },
): Promise<Map<string, { before: RawPresetPermissions[]; after: RawPresetPermissions[] }>> {
  const rows = await listTenantPresetAssignmentRows(db, params.tenantId);
  const map = new Map<string, { before: RawPresetPermissions[]; after: RawPresetPermissions[] }>();
  for (const row of rows) {
    const entry = map.get(row.userId) ?? { before: [], after: [] };
    const current: RawPresetPermissions = {
      grants: JSON.parse(row.grants) as RawPermissionGrant[],
      denies: JSON.parse(row.denies) as string[],
    };
    entry.before.push(current);
    entry.after.push(row.presetId === params.presetId ? params.next : current);
    map.set(row.userId, entry);
  }
  return map;
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

  const beforePresets = await listAssignedPresetGrants(db, { tenantId: actor.tenantId, userId: targetUserId });
  const afterPresets: RawPresetPermissions[] = presets.map(presetPermissionsOf);

  const beforeEffective = effectivePermissionsFromPresets(beforePresets);
  const afterEffective = effectivePermissionsFromPresets(afterPresets);

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
    const allPresetsByUser = await listTenantPresetGrantsByUser(db, actor.tenantId);
    let otherHolders = 0;
    for (const [userId, userPresets] of allPresetsByUser) {
      if (userId === targetUserId) continue;
      const effective = effectivePermissionsFromPresets(userPresets);
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
