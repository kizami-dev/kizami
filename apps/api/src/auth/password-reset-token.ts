/**
 * パスワードリセットトークン(管理者発行、Tier 0)。
 *
 * トークン生成自体(32バイト乱数の base64url + SHA-256 hex 保存)は招待(auth/invitation-token.ts)
 * と全く同じ方式のため、generateInvitationToken をそのまま再利用する(重複実装しない)。
 * 異なるのは有効期限のみ: リセットは「今困っている人」への即時対応であり、招待(7日)ほど
 * 長い寿命を持たせる利益がないため 24時間に短縮する(packages/db/src/schema/password-resets.ts
 * の設計コメント参照)。定数はこちら(リセット側)に持つ。
 */

export { generateInvitationToken as generatePasswordResetToken } from "./invitation-token.js";

/** 24時間(分単位)。 */
export const PASSWORD_RESET_TTL_MINUTES = 24 * 60;
