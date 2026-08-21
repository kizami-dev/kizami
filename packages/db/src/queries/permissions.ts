/**
 * preset_assignments → permission_presets.grants(JSON)を読むクエリ層。
 *
 * grants の JSON 形式は `{ key: string; scope: string }[]`(apps/api/src/seed.ts の実データ、
 * packages/db/src/schema/permissions.ts のコメント参照)。@kizami/authz の Grant 型
 * (`{ permission, scope }`)へのマッピングは呼び出し側(apps/api/src/authz.ts)の責務とする
 * (db パッケージは @kizami/authz に依存しないため、ここでは生の形のまま返す)。
 */

import { and, eq } from "drizzle-orm";
import type { Database } from "../migrate.js";
import { permissionPresets, presetAssignments } from "../schema/index.js";

export interface RawPermissionGrant {
  key: string;
  scope: string;
}

export interface ListAssignedPresetGrantsParams {
  tenantId: string;
  userId: string;
}

/**
 * user に割り当てられている各プリセットの grants を、プリセットごとに1配列として返す
 * (割当0件なら空配列)。合算(union)は呼び出し側(@kizami/authz)の責務。
 */
export async function listAssignedPresetGrants(
  db: Database,
  params: ListAssignedPresetGrantsParams,
): Promise<RawPermissionGrant[][]> {
  const rows = await db
    .select({ grants: permissionPresets.grants })
    .from(presetAssignments)
    .innerJoin(permissionPresets, eq(presetAssignments.presetId, permissionPresets.id))
    .where(and(eq(presetAssignments.tenantId, params.tenantId), eq(presetAssignments.userId, params.userId)));

  return rows.map((row) => JSON.parse(row.grants) as RawPermissionGrant[]);
}
