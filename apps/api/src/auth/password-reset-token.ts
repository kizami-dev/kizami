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

/**
 * 1時間(分単位)。**本人用の「パスワードを忘れた」**(未認証で誰でも発行を要求できる)で出すリンクの寿命。
 *
 * 管理者発行(24時間)より短くする理由: (1) 管理者発行は「今困っている人に管理者が手渡す」ので、受け取る側の
 * 都合(翌朝に開く等)を見込んで長めだが、本人用は本人が今まさにメールを待っている操作で、1時間あれば足りる。
 * (2) 本人用は宛先のメールボックスに平文リンクが残る(転送・共有メールボックス・端末の紛失)ので、
 * 漂流する時間を短くしたい。(3) 要求自体は第三者でも出せる(他人のメール宛に送らせられる)ため、
 * 届いた不要なリンクが有効なまま残る時間も短い方がよい。期限切れは受諾画面が「再発行を依頼してください」
 * (410)で案内するので、短くても詰まらない。
 */
export const SELF_SERVICE_PASSWORD_RESET_TTL_MINUTES = 60;

/** 同じメール宛の本人用再設定メールを出す最小間隔(分)。signup の再送スロットルと同じ 5 分。 */
export const SELF_SERVICE_PASSWORD_RESET_THROTTLE_MINUTES = 5;
