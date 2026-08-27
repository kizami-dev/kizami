/**
 * 承認依頼通知の宛先解決。
 *
 * 参照: docs/requirements.md §7「管理者向けの通知(承認依頼…)は権限を持つ人に送る」。
 *
 * `resolveApproversForUser` は「subjectUser(申請対象者)をスコープに含む形で `permission` を
 * 保持しているユーザーID一覧」を返す。承認が権限ベース(スコープ self/department/
 * department_and_descendants/tenant)になった結果、「誰が承認できるか」は
 * (a) その人が permission を保持しているか、(b) 保持しているスコープに subjectUser が
 * 含まれるか、の2段で決まる。この2段は既存のアクセス可否判定と全く同じ問いなので、
 * 二重実装せず既存部品をそのまま再利用する:
 *
 * - apps/api/src/authz.ts の effectivePermissionsFromPresets: プリセット grants の合算+
 *   「操作は閲覧を含意」の展開(loadEffectivePermissions が1ユーザー分に対して行うのと同じ計算)。
 * - apps/api/src/lib/scope.ts の resolveAccessibleUserIds: 実効権限のスコープ→対象ユーザーID集合
 *   (routes/corrections.ts 等が承認時に「対象ユーザーがスコープ内か」を判定するのと同じ関数)。
 *
 * ここでは「承認者候補を actor に見立てて resolveAccessibleUserIds を呼び、その結果集合に
 * subjectUser が含まれるか」を判定に使う。つまり「〇〇さんは subjectUser を承認できるか」を、
 * 承認 API が普段行っている判定とまったく同じロジックで行う。
 *
 * 計算量・前提(パフォーマンス、依頼に明記の判断点):
 * テナント全ユーザー×全権限の総当たりはしない。候補は
 * `listTenantPresetGrantsByUser`(packages/db/src/queries/permissions.ts)が返す
 * 「テナント内で1つ以上プリセットを割り当てられているユーザー」のみに絞る
 * (プリセット割当が0件のユーザーはこの1回のクエリの結果に現れず、そもそも candidate に
 * ならない — 承認権限は必ずプリセット経由の付与であり自動付与〔SELF_SERVICE_GRANTS〕には
 * 含まれないため、この絞り込みで見逃しは起きない)。
 *
 * 候補ごとに resolveAccessibleUserIds を1回呼ぶため、その内部で読む部署一覧・
 * membership 一覧が候補の数だけ再読み込みされる(候補間でキャッシュしない)。
 * 計算量は概ね O(A × (D + M)):
 *   A = テナント内で `permission` を実際に保持する候補数(通常は管理者・マネージャ層の
 *       少数に留まる想定 — 一般従業員は承認権限を持たない)
 *   D = テナントの部署数、M = テナントの membership 行数
 * Tier 0 の想定規模(1テナントあたり数十〜数百人)では許容範囲と判断した。将来 A が
 * 大きくなるテナントが出てきた場合は、部署一覧・最新所属マップの読み出しをこの関数の
 * 呼び出し1回につき1回だけにまとめる(resolveAccessibleUserIds 側にキャッシュ注入口を作る)
 * 改修を検討すること。
 */

import { listTenantPresetGrantsByUser, type Database } from "@kizami/db";
import type { PermissionKey } from "@kizami/authz";
import { effectivePermissionsFromPresets } from "../authz.js";
import { resolveAccessibleUserIds, type ScopeActor } from "./scope.js";

export interface ResolveApproversForUserParams {
  tenantId: string;
  /** 申請対象ユーザー(この人をスコープに含む承認者だけを返す)。 */
  subjectUserId: string;
  permission: PermissionKey;
}

/**
 * subjectUser をスコープに含む形で permission を持つユーザーID一覧を返す(重複なし、順不同)。
 * 該当者が1人もいなければ空配列(呼び出し元はこれを「通知先が無い」として扱ってよい —
 * 権限カタログ上「承認者が誰もいない」状態はテナント運用上の不備だが、通知処理自体を
 * 失敗させる理由にはしない)。
 */
export async function resolveApproversForUser(db: Database, params: ResolveApproversForUserParams): Promise<string[]> {
  const { tenantId, subjectUserId, permission } = params;
  const grantsByUser = await listTenantPresetGrantsByUser(db, tenantId);

  const approvers: string[] = [];
  for (const [candidateUserId, rawGrantSets] of grantsByUser) {
    const effective = effectivePermissionsFromPresets(rawGrantSets);
    if (!effective.has(permission)) continue;

    const actor: ScopeActor = { id: candidateUserId, tenantId, permissions: effective };
    const accessible = await resolveAccessibleUserIds(db, { actor, permission });
    if (accessible === "all" || accessible.has(subjectUserId)) {
      approvers.push(candidateUserId);
    }
  }

  return approvers;
}

/**
 * 二段承認の**二次承認者候補**(= permission を tenant スコープで保持するユーザー)の
 * ID 一覧を返す(重複なし、順不同)。仕様: docs/design/approval-flows.md
 *
 * resolveApproversForUser と分けている理由: 二次承認は「申請対象者がスコープに入っているか」
 * ではなく「テナント全体を見る立場かどうか」で決まる(人事・本部を想定)。したがって
 * subjectUser に依存せず、スコープの解決(部署ツリーの読み出し)も不要 —
 * listTenantPresetGrantsByUser の1クエリと実効権限の合算だけで判定できる。
 *
 * 該当者が1人もいなければ空配列(呼び出し元は「通知先が無い」として扱ってよい)。
 * ただしその状態は「二段承認に設定したのに二次承認できる人がいない」というテナント運用の
 * 不備であり、申請は approved_step1 のまま滞留する — 設定画面側で注意喚起する
 * (apps/web/src/components/SettingsApprovalFlowView.tsx)。
 */
export async function resolveTenantScopeApprovers(
  db: Database,
  params: { tenantId: string; permission: PermissionKey },
): Promise<string[]> {
  const { tenantId, permission } = params;
  const grantsByUser = await listTenantPresetGrantsByUser(db, tenantId);

  const approvers: string[] = [];
  for (const [candidateUserId, rawGrantSets] of grantsByUser) {
    const effective = effectivePermissionsFromPresets(rawGrantSets);
    if (effective.get(permission) === "tenant") {
      approvers.push(candidateUserId);
    }
  }
  return approvers;
}
