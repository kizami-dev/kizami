/**
 * 認可の差し込み点。
 *
 * v0.1 は全エンドポイントが本人スコープのみ(requireSelf)。v0.2 でここに権限プリセット方式
 * (docs/design/permission-catalog.md)による認可を追加する:
 *
 * - loadEffectivePermissions(db, user): preset_assignments → permission_presets.grants / denies
 *   (JSON)を読み、@kizami/authz(ランタイム・DB非依存の純粋ロジック)で合算・「操作は閲覧を
 *   含意」の展開・拒否(deny)の適用まで行った実効権限を返す。authMiddleware がリクエストごとに1回だけ呼び、
 *   `c.set("permissions", …)` にキャッシュする(同一リクエスト内の複数 requirePermission
 *   呼び出しで再評価しない)。
 * - requirePermission(c, key, scope): キャッシュ済みの実効権限に対する判定のみを行う。
 *
 * 既存(v0.1/v0.2第一・二弾)のエンドポイントは requireSelf のままで挙動を変えない。
 * requirePermission は今回追加する設定API(routes/settings.ts)からのみ呼ばれる。
 */

import type { Context } from "hono";
import { listAssignedPresetGrants, type Database, type RawPresetPermissions } from "@kizami/db";
import { hasPermission as evaluatePermission, resolveEffectivePermissions } from "@kizami/authz";
import type { PermissionKey, PresetPermissions, Scope } from "@kizami/authz";
import type { AppEnv, AuthUser } from "./auth/middleware.js";

export class ForbiddenError extends Error {
  constructor(message = "forbidden") {
    super(message);
    this.name = "ForbiddenError";
  }
}

/** 認証済みユーザー自身が対象(targetUserId)でなければ ForbiddenError を投げる。 */
export function requireSelf(c: Context<AppEnv>, targetUserId: string): void {
  const actor = c.get("user");
  if (actor.id !== targetUserId) {
    throw new ForbiddenError("self-scope only in v0.1");
  }
}

const VALID_SCOPES: ReadonlySet<Scope> = new Set(["self", "department", "department_and_descendants", "tenant"]);

function isValidScope(value: string): value is Scope {
  return VALID_SCOPES.has(value as Scope);
}

/**
 * DB の grants / denies JSON(`{ key, scope }[]` と `string[]`。複数プリセット分)を
 * @kizami/authz の PresetPermissions 型へマッピングし、合算(union)・広いスコープ優先・
 * 「操作は閲覧を含意」の展開・**拒否(deny)の適用**まで行った実効権限を返す。
 *
 * deny は付与に優先する(どのプリセットが付与していても、1つでも拒否していれば無効)。
 * スコープを持たない全面的な拒否である理由と、セルフサービス権限が拒否対象外である理由は
 * packages/authz/src/types.ts(Deny 型)・self-service.ts のコメント参照。
 *
 * scope が4値のいずれでもない不正値は(将来のデータ不整合に備えた防御として)無視する。
 *
 * DB を読まない純粋関数として切り出しているのは、routes/presets.ts の固定原則
 * (自己昇格・自己降格・最後の権限管理保持者)判定が「まだ保存していない、割当変更後・
 * プリセット編集後の仮の実効権限」を計算する必要があり、DB からの読み出しと合成ロジックを
 * 分離しておくと全ての呼び出し元で再利用できるため。
 */
export function effectivePermissionsFromPresets(rawPresets: readonly RawPresetPermissions[]): Map<PermissionKey, Scope> {
  const presets: PresetPermissions[] = rawPresets.map((preset) => ({
    grants: preset.grants.filter((g) => isValidScope(g.scope)).map((g) => ({ permission: g.key, scope: g.scope as Scope })),
    denies: preset.denies,
  }));

  return resolveEffectivePermissions(presets);
}

/**
 * user に割り当てられた全プリセットの grants / denies を読み、実効権限
 * (合算・含意展開・拒否の適用まで済んだ最終形)を返す。
 */
export async function loadEffectivePermissions(
  db: Database,
  user: Pick<AuthUser, "id" | "tenantId">,
): Promise<Map<PermissionKey, Scope>> {
  const rawPresets = await listAssignedPresetGrants(db, { tenantId: user.tenantId, userId: user.id });
  return effectivePermissionsFromPresets(rawPresets);
}

/** キャッシュ済みの実効権限(c.get("permissions"))が key を requiredScope 以上で満たさなければ ForbiddenError を投げる。 */
export function requirePermission(c: Context<AppEnv>, key: PermissionKey, requiredScope: Scope): void {
  const permissions = c.get("permissions");
  if (!evaluatePermission(permissions, key, requiredScope)) {
    throw new ForbiddenError(`missing permission: ${key} (requires scope >= ${requiredScope})`);
  }
}
