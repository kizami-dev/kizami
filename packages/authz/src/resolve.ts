/**
 * 権限エンジン本体。
 *
 * 評価は「grantsの合成→判定」の2段構成に保つ(denyは実装しないが、将来の追加を妨げない
 * ため — docs/requirements.md §4「評価器はdeny追加を妨げない構造にしておく」):
 *   1. resolveEffectiveGrants(): 複数プリセットの合算(union)+固定原則(セルフサービス権限)
 *   2. expandImplied(): 「操作は閲覧を含意する」の展開
 *   3. hasPermission(): 1./2. の結果に対する判定のみ(ここに deny を差し込める)
 */

import { IMPLIED_VIEW_PERMISSIONS } from "./implied.js";
import { SELF_SERVICE_GRANTS } from "./self-service.js";
import { widerScope, scopeSatisfies } from "./scope.js";
import type { Grant, PermissionKey, Scope } from "./types.js";

/**
 * 複数プリセットの grants を合算(union)する。同一権限に複数スコープが来たら広い方を採用する
 * (docs/requirements.md §4「実効権限はその合算(union)」)。
 *
 * 固定原則(セルフサービス権限)は常に合算対象に含める — プリセット割当が0件でも
 * 全ユーザーが自分の打刻・申請・記録閲覧を保持する、という要件をここで一元的に満たす。
 */
export function resolveEffectiveGrants(presets: Grant[][]): Map<PermissionKey, Scope> {
  const effective = new Map<PermissionKey, Scope>();

  const applyGrant = (grant: Grant): void => {
    const current = effective.get(grant.permission);
    effective.set(grant.permission, current === undefined ? grant.scope : widerScope(current, grant.scope));
  };

  for (const grant of SELF_SERVICE_GRANTS) applyGrant(grant);
  for (const preset of presets) {
    for (const grant of preset) applyGrant(grant);
  }

  return effective;
}

/**
 * 「操作は閲覧を含意する」を展開する。実効権限マップの各キーについて
 * IMPLIED_VIEW_PERMISSIONS を引き、含意される閲覧権限を同じスコープで(既存の付与がより
 * 広ければそちらを優先して)追加する。
 *
 * 含意関係は「操作→閲覧」の1段のみで、含意先(閲覧権限)がさらに何かを含意することは
 * カタログ上ない。ただし将来の変更に備え、値が変化しなくなるまで(不動点まで)適用する。
 */
export function expandImplied(effective: Map<PermissionKey, Scope>): Map<PermissionKey, Scope> {
  let current = new Map(effective);

  for (let pass = 0; pass < 10; pass++) {
    const next = new Map(current);
    let changed = false;

    for (const [key, scope] of current) {
      const implied = IMPLIED_VIEW_PERMISSIONS[key];
      if (!implied) continue;
      for (const impliedKey of implied) {
        const existing = next.get(impliedKey);
        const merged = existing === undefined ? scope : widerScope(existing, scope);
        if (existing !== merged) {
          next.set(impliedKey, merged);
          changed = true;
        }
      }
    }

    current = next;
    if (!changed) break;
  }

  return current;
}

/** 実効権限マップが key を requiredScope 以上のスコープで保持しているか判定する。 */
export function hasPermission(effective: Map<PermissionKey, Scope>, key: PermissionKey, requiredScope: Scope): boolean {
  const granted = effective.get(key);
  if (granted === undefined) return false;
  return scopeSatisfies(granted, requiredScope);
}
