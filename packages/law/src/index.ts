/**
 * KIZAMI 法令ルール版管理パッケージ
 *
 * 制約:
 * - 純関数のみ。I/O・Date.now()・タイムゾーン暗黙依存を持たない
 * - node:* も外部依存も使わない(依存ゼロ)
 * - 法改正は「新しい版を1つ追加する」ことでのみ反映し、既存の版は書き換えない(README.md 参照)
 */

export { buildLawTimeline, listUpcomingChanges, resolveLawRules } from "./resolve.js";
export type * from "./types.js";
export { LAW_VERSIONS } from "./versions.js";
