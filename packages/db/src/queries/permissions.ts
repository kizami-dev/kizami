/**
 * preset_assignments → permission_presets.grants / denies(JSON)を読むクエリ層。
 *
 * grants の JSON 形式は `{ key: string; scope: string }[]`、denies は `string[]`
 * (スコープなし。apps/api/src/seed.ts の実データ、packages/db/src/schema/permissions.ts の
 * コメント参照)。@kizami/authz の Grant / PresetPermissions 型へのマッピングは
 * 呼び出し側(apps/api/src/authz.ts)の責務とする
 * (db パッケージは @kizami/authz に依存しないため、ここでは生の形のまま返す)。
 */

import { and, eq } from "drizzle-orm";
import type { Database } from "../migrate.js";
import { permissionPresets, presetAssignments } from "../schema/index.js";
import { uuidv7 } from "../uuid.js";

export interface RawPermissionGrant {
  key: string;
  scope: string;
}

/**
 * 1プリセット分の権限(付与+拒否)の生の形。deny はスコープを持たない権限キーの配列
 * (packages/db/src/schema/permissions.ts の denies 列コメント参照)。
 * @kizami/authz の PresetPermissions 型へのマッピングは呼び出し側(apps/api/src/authz.ts)の責務。
 */
export interface RawPresetPermissions {
  grants: RawPermissionGrant[];
  denies: string[];
}

function parsePresetPermissions(row: { grants: string; denies: string }): RawPresetPermissions {
  return {
    grants: JSON.parse(row.grants) as RawPermissionGrant[],
    denies: JSON.parse(row.denies) as string[],
  };
}

export type PermissionPreset = typeof permissionPresets.$inferSelect;

export interface ListAssignedPresetGrantsParams {
  tenantId: string;
  userId: string;
}

/**
 * user に割り当てられている各プリセットの grants / denies を、プリセットごとに1件として返す
 * (割当0件なら空配列)。合算(union)と deny の適用は呼び出し側(@kizami/authz)の責務。
 */
export async function listAssignedPresetGrants(
  db: Database,
  params: ListAssignedPresetGrantsParams,
): Promise<RawPresetPermissions[]> {
  const rows = await db
    .select({ grants: permissionPresets.grants, denies: permissionPresets.denies })
    .from(presetAssignments)
    .innerJoin(permissionPresets, eq(presetAssignments.presetId, permissionPresets.id))
    .where(and(eq(presetAssignments.tenantId, params.tenantId), eq(presetAssignments.userId, params.userId)));

  return rows.map(parsePresetPermissions);
}

/**
 * テナント内の全ユーザーについて、割り当てられている各プリセットの grants / denies を
 * ユーザーIDでグルーピングして返す(割当が1件も無いユーザーはマップに現れない —
 * 呼び出し側は `?? []` で空配列扱いすること)。
 *
 * 「最後の権限管理保持者」判定(apps/api/src/routes/presets.ts の固定原則)のように
 * テナント全ユーザーの実効権限をまとめて評価する必要がある場面で使う、
 * listAssignedPresetGrants の bulk 版。
 */
export async function listTenantPresetGrantsByUser(db: Database, tenantId: string): Promise<Map<string, RawPresetPermissions[]>> {
  const rows = await db
    .select({ userId: presetAssignments.userId, grants: permissionPresets.grants, denies: permissionPresets.denies })
    .from(presetAssignments)
    .innerJoin(permissionPresets, eq(presetAssignments.presetId, permissionPresets.id))
    .where(eq(presetAssignments.tenantId, tenantId));

  const map = new Map<string, RawPresetPermissions[]>();
  for (const row of rows) {
    const list = map.get(row.userId) ?? [];
    list.push(parsePresetPermissions(row));
    map.set(row.userId, list);
  }
  return map;
}

/** listTenantPresetAssignments の1行(どのユーザーにどのプリセットが割り当たっているか)。 */
export interface TenantPresetAssignmentRow {
  userId: string;
  presetId: string;
  /** `{ key, scope }[]` の JSON 文字列 */
  grants: string;
  /** `string[]`(拒否する権限キー)の JSON 文字列 */
  denies: string;
}

/**
 * テナント内の全プリセット割当を「ユーザー × プリセット」の生の行として返す。
 *
 * listTenantPresetGrantsByUser との違いは presetId を保持する点。プリセット編集
 * (PATCH /presets/:id)の「最後の権限管理保持者」判定は、割当のうち**編集対象のプリセットだけ**を
 * 編集後の内容へ差し替えて実効権限を計算し直す必要があり、どの行が対象プリセットかを
 * 識別できなければならない(内容の一致で判定すると同一内容の別プリセットを取り違える)。
 */
export async function listTenantPresetAssignmentRows(db: Database, tenantId: string): Promise<TenantPresetAssignmentRow[]> {
  return db
    .select({
      userId: presetAssignments.userId,
      presetId: presetAssignments.presetId,
      grants: permissionPresets.grants,
      denies: permissionPresets.denies,
    })
    .from(presetAssignments)
    .innerJoin(permissionPresets, eq(presetAssignments.presetId, permissionPresets.id))
    .where(eq(presetAssignments.tenantId, tenantId));
}

export async function listPresets(db: Database, tenantId: string): Promise<PermissionPreset[]> {
  return db.select().from(permissionPresets).where(eq(permissionPresets.tenantId, tenantId));
}

export async function getPresetById(db: Database, params: { tenantId: string; id: string }): Promise<PermissionPreset | null> {
  const rows = await db
    .select()
    .from(permissionPresets)
    .where(and(eq(permissionPresets.tenantId, params.tenantId), eq(permissionPresets.id, params.id)))
    .limit(1);
  return rows[0] ?? null;
}

export interface CreatePresetInput {
  id: string;
  tenantId: string;
  name: string;
  description: string | null;
  /** `{ key, scope }[]` の JSON 文字列 */
  grants: string;
  /** `string[]`(拒否する権限キー)の JSON 文字列。省略時は "[]"(拒否なし)。 */
  denies?: string;
  createdAt: number;
}

/** 新規プリセットを作成する。ユーザー作成プリセットは常に isSystem=false(同梱プリセットは seed.ts のみが作る)。 */
export async function createPreset(db: Database, input: CreatePresetInput): Promise<PermissionPreset> {
  const [row] = await db
    .insert(permissionPresets)
    .values({ ...input, isSystem: false })
    .returning();
  if (!row) {
    throw new Error("createPreset: insert returned no row");
  }
  return row;
}

export interface UpdatePresetInput {
  id: string;
  tenantId: string;
  name?: string;
  description?: string | null;
  /** `{ key, scope }[]` の JSON 文字列 */
  grants?: string;
  /** `string[]`(拒否する権限キー)の JSON 文字列 */
  denies?: string;
}

/**
 * プリセットを更新する。isSystem チェック(編集不可)は呼び出し側(ルート層)の責務。
 * name/description/grants/denies のうち渡されたフィールドのみ更新する。
 */
export async function updatePreset(db: Database, input: UpdatePresetInput): Promise<PermissionPreset | null> {
  const { id, tenantId, ...rest } = input;
  const setValues: Partial<typeof permissionPresets.$inferInsert> = {};
  if (rest.name !== undefined) setValues.name = rest.name;
  if (rest.description !== undefined) setValues.description = rest.description;
  if (rest.grants !== undefined) setValues.grants = rest.grants;
  if (rest.denies !== undefined) setValues.denies = rest.denies;

  if (Object.keys(setValues).length === 0) {
    return getPresetById(db, { tenantId, id });
  }

  const [row] = await db
    .update(permissionPresets)
    .set(setValues)
    .where(and(eq(permissionPresets.tenantId, tenantId), eq(permissionPresets.id, id)))
    .returning();
  return row ?? null;
}

/** 削除する。isSystem チェック・割当有無(409 preset_in_use)チェックは呼び出し側の責務。 */
export async function deletePreset(db: Database, params: { tenantId: string; id: string }): Promise<boolean> {
  const result = await db
    .delete(permissionPresets)
    .where(and(eq(permissionPresets.tenantId, params.tenantId), eq(permissionPresets.id, params.id)))
    .returning({ id: permissionPresets.id });
  return result.length > 0;
}

/** そのプリセットへの割当件数(削除時の 409 preset_in_use 判定用)。 */
export async function countPresetAssignments(db: Database, params: { tenantId: string; presetId: string }): Promise<number> {
  const rows = await db
    .select({ id: presetAssignments.id })
    .from(presetAssignments)
    .where(and(eq(presetAssignments.tenantId, params.tenantId), eq(presetAssignments.presetId, params.presetId)));
  return rows.length;
}

export interface ReplacePresetAssignmentsInput {
  tenantId: string;
  userId: string;
  presetIds: string[];
  createdAt: number;
}

/** あるユーザーのプリセット割当を、指定した presetIds の集合で丸ごと置き換える(トランザクション)。 */
export async function replacePresetAssignmentsForUser(db: Database, input: ReplacePresetAssignmentsInput): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .delete(presetAssignments)
      .where(and(eq(presetAssignments.tenantId, input.tenantId), eq(presetAssignments.userId, input.userId)));

    if (input.presetIds.length > 0) {
      await tx.insert(presetAssignments).values(
        input.presetIds.map((presetId) => ({
          id: uuidv7(),
          tenantId: input.tenantId,
          userId: input.userId,
          presetId,
          createdAt: input.createdAt,
        })),
      );
    }
  });
}
