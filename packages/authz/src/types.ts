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
