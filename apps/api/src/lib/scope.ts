/**
 * 権限スコープ(self / department / department_and_descendants / tenant)を
 * 実リソース(ユーザーID・部署ID)に対して解決する窓口。
 *
 * 背景: @kizami/authz はスコープの保持・合成(実効権限の計算)までしか行わず、DB非依存。
 * 「実際にどのユーザー/部署が操作対象になり得るか」は各APIが個別に判定する必要があるが、
 * それをエンドポイントごとに書くと判定ロジックが散らばり実装漏れの温床になる
 * (実際、v0.2 第一弾では members/departments/presets が「粗い粒度」のまま残っていた)。
 * この2関数をその唯一の窓口とし、今後 他人の勤怠を見る系のエンドポイントが増える場合も
 * ここを経由すること。
 *
 * 部署ツリーはテナントあたり小規模という前提を置き、常に全件を読みメモリ上で辿る
 * (再帰CTE等のSQLは書かない — packages/db/src/queries/departments.ts の既存方針を踏襲)。
 */

import { getLatestMembership, listDepartments, listTenantMembershipsWithDepartment, type Database, type Department } from "@kizami/db";
import type { PermissionKey, Scope } from "@kizami/authz";
import { ForbiddenError } from "../authz.js";

/**
 * スコープ判定に必要な actor の最小情報。呼び出し側は
 * `{ id: user.id, tenantId: user.tenantId, permissions: c.get("permissions") }` を渡す想定。
 */
export interface ScopeActor {
  id: string;
  tenantId: string;
  permissions: Map<PermissionKey, Scope>;
}

/** actor が permission を保持していなければ ForbiddenError。保持していればそのスコープを返す。 */
function requireGrantedScope(actor: ScopeActor, permission: PermissionKey): Scope {
  const scope = actor.permissions.get(permission);
  if (scope === undefined) {
    throw new ForbiddenError(`missing permission: ${permission}`);
  }
  return scope;
}

/** parentId → 子部署ID[] のマップを組み立てる(departments.ts の isSelfOrDescendant と同じ形)。 */
function buildChildrenByParent(all: Department[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const d of all) {
    if (d.parentId === null) continue;
    const list = map.get(d.parentId) ?? [];
    list.push(d.id);
    map.set(d.parentId, list);
  }
  return map;
}

/** rootId 自身 + 配下すべての部署ID(DFS)。 */
function collectSelfAndDescendants(childrenByParent: Map<string, string[]>, rootId: string): Set<string> {
  const result = new Set<string>([rootId]);
  const stack = [...(childrenByParent.get(rootId) ?? [])];
  while (stack.length > 0) {
    const current = stack.pop() as string;
    if (result.has(current)) continue;
    result.add(current);
    stack.push(...(childrenByParent.get(current) ?? []));
  }
  return result;
}

/** actor 自身の所属部署ID(最新のmembership、packages/db/src/queries/members.ts の規約通り)。無所属なら null。 */
async function actorDepartmentId(db: Database, actor: ScopeActor): Promise<string | null> {
  const membership = await getLatestMembership(db, { tenantId: actor.tenantId, userId: actor.id });
  return membership?.departmentId ?? null;
}

/** userId → 現在の所属部署ID(最新membership)のマップ。 */
async function latestDepartmentByUser(db: Database, tenantId: string): Promise<Map<string, string>> {
  // listTenantMembershipsWithDepartment は createdAt 降順を返す規約(packages/db/src/queries/members.ts)。
  // 同一userIdが複数出現した場合、最初に出現した(=最新の)行だけを採用する。
  const rows = await listTenantMembershipsWithDepartment(db, tenantId);
  const map = new Map<string, string>();
  for (const row of rows) {
    if (!map.has(row.userId)) {
      map.set(row.userId, row.departmentId);
    }
  }
  return map;
}

/**
 * 実効権限のスコープに応じて、actor が `permission` を用いて操作対象にできる
 * ユーザーIDの集合を返す。`"all"` はテナント全体(集合を作らずに済ませる最適化)。
 *
 * - self: 本人のみ
 * - department: 自分の所属部署に属するユーザーのみ
 * - department_and_descendants: 自分の所属部署 + 配下部署に属するユーザー
 * - tenant: "all"
 *
 * 判断点: actor 自身が無所属(memberships が無い)場合、department /
 * department_and_descendants スコープでは「絞り込む対象部署が無い」ため、空集合ではなく
 * 「本人のみ」を返す(「所属が無い=誰も操作できない」ではなく「所属が無い=自分の分だけは
 * 操作できる」という解釈。本人自身の勤怠・プロフィールは常に本人の管轄であるべきという
 * 直感に合わせた)。
 *
 * permission を一切保持していない場合は(空集合ではなく)ForbiddenError を投げる。
 * 呼び出し側で requirePermission と二重に最低スコープを書かなくて済むようにするため。
 */
export async function resolveAccessibleUserIds(
  db: Database,
  params: { actor: ScopeActor; permission: PermissionKey },
): Promise<Set<string> | "all"> {
  const { actor, permission } = params;
  const scope = requireGrantedScope(actor, permission);

  if (scope === "tenant") return "all";
  if (scope === "self") return new Set([actor.id]);

  const deptId = await actorDepartmentId(db, actor);
  if (deptId === null) return new Set([actor.id]);

  const allDepartments = scope === "department_and_descendants" ? await listDepartments(db, actor.tenantId) : null;
  const targetDeptIds =
    allDepartments === null ? new Set([deptId]) : collectSelfAndDescendants(buildChildrenByParent(allDepartments), deptId);

  const deptByUser = await latestDepartmentByUser(db, actor.tenantId);
  const result = new Set<string>();
  for (const [userId, departmentId] of deptByUser) {
    if (targetDeptIds.has(departmentId)) result.add(userId);
  }
  // actor 自身の最新所属は deptId(=targetDeptIds に含まれる)のため通常は上のループで
  // 含まれるはずだが、不変条件として明示しておく。
  result.add(actor.id);
  return result;
}

/**
 * 実効権限のスコープに応じて、actor が `permission` を用いて操作対象にできる
 * 部署IDの集合を返す。`"all"` はテナント全体。
 *
 * - department: 自分の所属部署のみ
 * - department_and_descendants: 自分の所属部署 + 配下部署
 * - tenant: "all"
 * - self: 部署管理系の権限に self スコープが存在するカタログ定義は無いが(念のため)
 *   department と同じ(自分の所属部署のみ)として扱う。
 *
 * 判断点: actor が無所属の場合、対象にできる部署が存在しないため空集合を返す
 * (resolveAccessibleUserIds と異なり「本人」に相当する部署は無いため)。
 *
 * permission を一切保持していない場合は ForbiddenError を投げる。
 */
export async function resolveAccessibleDepartmentIds(
  db: Database,
  params: { actor: ScopeActor; permission: PermissionKey },
): Promise<Set<string> | "all"> {
  const { actor, permission } = params;
  const scope = requireGrantedScope(actor, permission);

  if (scope === "tenant") return "all";

  const deptId = await actorDepartmentId(db, actor);
  if (deptId === null) return new Set();

  if (scope === "self" || scope === "department") {
    return new Set([deptId]);
  }

  const allDepartments = await listDepartments(db, actor.tenantId);
  return collectSelfAndDescendants(buildChildrenByParent(allDepartments), deptId);
}
