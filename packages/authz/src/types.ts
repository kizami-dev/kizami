/**
 * KIZAMI 権限エンジンの型定義。
 *
 * 参照: docs/design/permission-catalog.md(権限キー・スコープの定義。これが仕様の正)
 * docs/requirements.md §4(複数プリセット合算・denyなし・操作は閲覧を含意・固定原則)
 */

/** 業務タスク権限キー(例 "attendance.correction.approve")。カタログで定義される文字列。 */
export type PermissionKey = string;

/**
 * 権限の適用スコープ。カタログ §前提の機械可読キー(2026-08-21確定)をそのまま採用する。
 * 広さの順序(狭い→広い): self < department < department_and_descendants < tenant
 */
export type Scope = "self" | "department" | "department_and_descendants" | "tenant";

/** 1件の権限付与(プリセットの grants 配列の要素)。 */
export interface Grant {
  permission: PermissionKey;
  scope: Scope;
}

/**
 * 1件の拒否(プリセットの denies 配列の要素)。
 *
 * **denyはスコープを持たない(意図的)**。`closing.execute` を拒否したら、そのユーザーは
 * どのスコープでも `closing.execute` を行えない。部分スコープの deny(「自部署では拒否だが
 * テナント全体では許可」)を許すと、スコープが広がるほど権限も広がるという本モデルの
 * メンタルモデルが反転し、「部署では拒否だが全社では許可」という読み解きの罠が生まれる。
 * 拒否は「その業務タスクを一切させない」という全面的な意思表示に限定する
 * (docs/design/permission-catalog.md §拒否(deny)ルール)。
 */
export type Deny = PermissionKey;

/** 1つのプリセットが持つ権限(付与+拒否)。deny は付与と同じくプリセット単位で保持する。 */
export interface PresetPermissions {
  grants: readonly Grant[];
  /** このプリセットが拒否する権限キー(スコープなし)。 */
  denies?: readonly Deny[];
}
