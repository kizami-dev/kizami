/**
 * 認可の差し込み点。
 *
 * v0.1 は全エンドポイントが本人スコープのみ(requireSelf)。v0.2 でここに権限プリセット方式
 * (docs/design/permission-catalog.md)による認可を追加する:
 *
 * - loadEffectivePermissions(db, user): preset_assignments → permission_presets.grants(JSON)
 *   を読み、@kizami/authz(ランタイム・DB非依存の純粋ロジック)で合算・「操作は閲覧を含意」の
 *   展開まで行った実効権限を返す。authMiddleware がリクエストごとに1回だけ呼び、
 *   `c.set("permissions", …)` にキャッシュする(同一リクエスト内の複数 requirePermission
 *   呼び出しで再評価しない)。
 * - requirePermission(c, key, scope): キャッシュ済みの実効権限に対する判定のみを行う。
 *
 * 既存(v0.1/v0.2第一・二弾)のエンドポイントは requireSelf のままで挙動を変えない。
 * requirePermission は今回追加する設定API(routes/settings.ts)からのみ呼ばれる。
 */

import type { Context } from "hono";
import { listAssignedPresetGrants, type Database, type RawPermissionGrant } from "@kizami/db";
import { expandImplied, hasPermission as evaluatePermission, resolveEffectiveGrants } from "@kizami/authz";
import type { Grant, PermissionKey, Scope } from "@kizami/authz";
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
 * DB の grants JSON(`{ key, scope }[]` 形式。複数プリセット分の配列の配列)を
 * @kizami/authz の Grant 型(`{ permission, scope }`)へマッピングし、合算(union)・
 * 広いスコープ優先・「操作は閲覧を含意」の展開まで行った実効権限を返す。
 *
 * scope が4値のいずれでもない不正値は(将来のデータ不整合に備えた防御として)無視する。
 *
 * DB を読まない純粋関数として切り出しているのは、routes/presets.ts の固定原則
 * (自己昇格・自己降格・最後の権限管理保持者)判定が「まだ保存していない、割当変更後の
 * 仮の実効権限」を計算する必要があり、DB からの読み出しと合成ロジックを分離しておくと
 * 両方の呼び出し元(loadEffectivePermissions とプリセット割当の事前検証)で再利用できるため。
 */
export function effectivePermissionsFromRawGrantSets(rawGrantSets: RawPermissionGrant[][]): Map<PermissionKey, Scope> {
  const grantSets: Grant[][] = rawGrantSets.map((grants) =>
    grants.filter((g) => isValidScope(g.scope)).map((g) => ({ permission: g.key, scope: g.scope as Scope })),
  );

  return expandImplied(resolveEffectiveGrants(grantSets));
}

/**
 * user に割り当てられた全プリセットの grants を読み、実効権限(合算・含意展開済み)を返す。
 */
export async function loadEffectivePermissions(
  db: Database,
  user: Pick<AuthUser, "id" | "tenantId">,
): Promise<Map<PermissionKey, Scope>> {
  const rawGrantSets = await listAssignedPresetGrants(db, { tenantId: user.tenantId, userId: user.id });
  return effectivePermissionsFromRawGrantSets(rawGrantSets);
}

/** キャッシュ済みの実効権限(c.get("permissions"))が key を requiredScope 以上で満たさなければ ForbiddenError を投げる。 */
export function requirePermission(c: Context<AppEnv>, key: PermissionKey, requiredScope: Scope): void {
  const permissions = c.get("permissions");
  if (!evaluatePermission(permissions, key, requiredScope)) {
    throw new ForbiddenError(`missing permission: ${key} (requires scope >= ${requiredScope})`);
  }
}
