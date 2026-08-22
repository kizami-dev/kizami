/**
 * KIZAMI 個人情報まわりの雛形(従業員向けプライバシー通知・社内利用規約)。
 *
 * 制約(packages/leave・packages/engine と同じ方針、docs/design/ui-direction.md
 * 「個人情報まわりの雛形」):
 * - 純関数のみ。I/O・Date.now() 依存を持たない。Node と workerd の両方で同一に動作する
 * - KIZAMI 自身の個人情報の管理者は導入企業であり、KIZAMI プロジェクトではない。
 *   ここで作るのはあくまで雛形であり、法的助言ではない
 */

export { TEMPLATE_DISCLAIMER } from "./disclaimer.js";
export { buildInternalTerms } from "./terms.js";
export { buildPrivacyNotice } from "./notice.js";
export type * from "./types.js";
