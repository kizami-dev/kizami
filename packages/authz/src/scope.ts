/**
 * スコープの広さの比較。
 *
 * 順序(狭い→広い): self < department < department_and_descendants < tenant
 * (docs/design/permission-catalog.md 前提「スコープの機械可読キー」を参照)
 */

import type { Scope } from "./types.js";

const SCOPE_ORDER: Record<Scope, number> = {
  self: 0,
  department: 1,
  department_and_descendants: 2,
  tenant: 3,
};

/** スコープの広さを数値化する(比較・ソート用)。 */
export function scopeRank(scope: Scope): number {
  return SCOPE_ORDER[scope];
}

/** 2つのスコープのうち広い方を返す(同じ場合は a)。 */
export function widerScope(a: Scope, b: Scope): Scope {
  return scopeRank(b) > scopeRank(a) ? b : a;
}

/** 保有スコープ `granted` が要求スコープ `required` を満たすか(広い方が狭い要求を満たす)。 */
export function scopeSatisfies(granted: Scope, required: Scope): boolean {
  return scopeRank(granted) >= scopeRank(required);
}
