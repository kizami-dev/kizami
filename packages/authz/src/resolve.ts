/**
 * 権限エンジン本体。
 *
 * 評価は「grantsの合成→denyの適用→判定」の3段構成:
 *   1. resolveEffectiveGrants(): 複数プリセットの合算(union)+固定原則(セルフサービス権限)
 *   2. expandImplied(): 「操作は閲覧を含意する」の展開
 *   3. hasPermission(): 1./2. の結果に対する判定のみ
 *
 * 拒否ルール(deny、2026-08-24 実装。docs/requirements.md §4 のロードマップ項目「権限denyルール」)は
 * 1. と 2. の**両方の直後**に適用する(applyDenies)。理由は resolveEffectivePermissions のコメント参照。
 * 全部入りの入口は resolveEffectivePermissions() で、apps/api はこれ1本を呼ぶ。
 */

import { IMPLIED_VIEW_PERMISSIONS } from "./implied.js";
import { SELF_SERVICE_GRANTS, isDeniablePermission } from "./self-service.js";
import { widerScope, scopeSatisfies } from "./scope.js";
import type { Deny, Grant, PermissionKey, PresetPermissions, Scope } from "./types.js";

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

/**
 * 拒否(deny)を実効権限マップへ適用する。**denyはスコープを持たず全面的**なので、
 * 該当キーをマップから丸ごと取り除くだけでよい(部分スコープの deny を持たない理由は
 * types.ts の Deny 型のコメント参照)。
 *
 * セルフサービス権限(UNDENIABLE_PERMISSIONS)への deny は黙って無視する
 * (self-service.ts のコメント参照)。
 *
 * 入力のマップは変更せず、新しいマップを返す。
 */
export function applyDenies(effective: Map<PermissionKey, Scope>, denies: Iterable<Deny>): Map<PermissionKey, Scope> {
  const result = new Map(effective);
  for (const key of denies) {
    if (!isDeniablePermission(key)) continue;
    result.delete(key);
  }
  return result;
}

/**
 * 複数プリセット(付与+拒否)から実効権限の最終形を求める、権限エンジンの唯一の入口。
 *
 * 合成規則: **(全プリセットの grants の union) − (全プリセットの denies の union)**。
 * 1つでも deny を持つプリセットが割り当てられていれば、他のどのプリセットが付与していても
 * その権限は無効になる(deny は付与に優先する)。
 *
 * deny を「合算直後」と「含意展開後」の2回適用しているのは、両方に意味があるため(判断点):
 *   - 合算直後: 拒否された操作権限は、そこから「操作は閲覧を含意する」の展開も起こさない。
 *     例) `closing.execute` を拒否 → `closing.view` も(他に付与元が無ければ)得られない。
 *     拒否したのに拒否した権限由来の閲覧だけ残る、という中途半端な状態を作らない。
 *   - 含意展開後: 他の権限の含意によって拒否対象が復活するのを防ぐ。
 *     例) `attendance.record.view` を拒否 → `shift.manage` が含意していても得られない。
 */
export function resolveEffectivePermissions(presets: readonly PresetPermissions[]): Map<PermissionKey, Scope> {
  const denies: Deny[] = [];
  for (const preset of presets) {
    if (preset.denies) denies.push(...preset.denies);
  }

  const unioned = applyDenies(
    resolveEffectiveGrants(presets.map((p) => [...p.grants])),
    denies,
  );
  return applyDenies(expandImplied(unioned), denies);
}

/** 実効権限マップが key を requiredScope 以上のスコープで保持しているか判定する。 */
export function hasPermission(effective: Map<PermissionKey, Scope>, key: PermissionKey, requiredScope: Scope): boolean {
  const granted = effective.get(key);
  if (granted === undefined) return false;
  return scopeSatisfies(granted, requiredScope);
}
