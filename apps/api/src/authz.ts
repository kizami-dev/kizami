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
import { hasPermission as evaluatePermission, resolveEffectivePermissions, scopeRank } from "@kizami/authz";
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

/**
 * 自分自身の人事属性(入社日・有給付与の区分・所属部署・労働時間制の割当・有給の付与)を
 * 自分で変えようとしたときに返すエラーコード(403)。
 */
export const CANNOT_EDIT_OWN_HR_ATTRIBUTES = "cannot_edit_own_hr_attributes";

/**
 * 人事属性の変更の対象が操作者本人なら 403 `cannot_edit_own_hr_attributes` の応答を返す
 * (本人でなければ null)。
 *
 * 判断点(2026-10、セキュリティ診断): 入社日・付与区分・有給の付与は有給の日数に直結し、
 * 所属部署・労働時間制は承認者と集計を決める。どれも監査ログには残るが、編集権限さえあれば
 * 自分の分も変えられたため、管理者が自分の有給を増やす・勤続年数を盛ることができた。
 * **誰も自分の人事属性は変えられない**(テナント全体スコープの管理者も、別の管理者に依頼する)
 * を固定原則にする。管理者が1人しかいないテナントでは、その管理者の人事属性は誰も変えられない
 * (権限を持つ2人目を置く。docs/requirements.md §4 に明記)。
 */
export function rejectOwnHrAttributeEdit(c: Context<AppEnv>, targetUserId: string): Response | null {
  if (c.get("user").id !== targetUserId) return null;
  return c.json({ error: CANNOT_EDIT_OWN_HR_ATTRIBUTES }, 403);
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

/**
 * `subject` の実効権限が `holder` の実効権限に収まっているか(どのキーも holder が同じか
 * より広いスコープで持っているか)を調べ、収まっていない最初のキーを返す(全て収まれば null)。
 *
 * 「自分より上の人を操作させない」判定(H3、2026-10-22)の共通部品。用途は2つ:
 * - 他人のアカウント・資格情報に対する操作(リセット発行・2FA 解除・無効化など)で、
 *   対象の権限が操作者を上回っていないこと(requireActorDominatesTarget)
 * - プリセット割当(routes/presets.ts の assignPresetsToMember)で、割当後の対象の権限が
 *   操作者の権限に収まること(自己昇格の禁止は、この判定の「対象 = 自分」の場合にあたる)
 *
 * セルフサービス権限(scope: self)は全員が常に持つので、ここで差が出ることはない。
 */
export function findPermissionExceeding(
  subject: ReadonlyMap<PermissionKey, Scope>,
  holder: ReadonlyMap<PermissionKey, Scope>,
): PermissionKey | null {
  for (const [key, subjectScope] of subject) {
    const holderScope = holder.get(key);
    if (holderScope === undefined || scopeRank(subjectScope) > scopeRank(holderScope)) return key;
  }
  return null;
}

/**
 * 他人のアカウント・資格情報に対する操作(パスワードリセットの発行・招待の再発行・2FA の解除・
 * 無効化・再有効化)の前に呼ぶ。対象の実効権限が操作者(キャッシュ済みの c.get("permissions"))を
 * 上回る — 操作者に無い権限を持つ、または同じ権限をより広いスコープで持つ — なら ForbiddenError。
 *
 * 部署スコープの判定(lib/scope.ts)だけでは「自部署に所属する管理者」も操作対象に入ってしまい、
 * `member.invite` だけを持つ部署担当者が管理者のリセットトークンを発行して乗っ取れた(H3)。
 * テナント全体の全権限を持つ管理者は誰に対しても上回られないので、従来どおり全員を操作できる。
 */
export async function requireActorDominatesTarget(
  c: Context<AppEnv>,
  db: Database,
  targetUserId: string,
): Promise<void> {
  const actor = c.get("user");
  const targetPermissions = await loadEffectivePermissions(db, { id: targetUserId, tenantId: actor.tenantId });
  const exceeding = findPermissionExceeding(targetPermissions, c.get("permissions"));
  if (exceeding !== null) {
    throw new ForbiddenError(`target user ${targetUserId} holds ${exceeding} beyond actor's permissions`);
  }
}
