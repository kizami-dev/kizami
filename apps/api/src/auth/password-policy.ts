/**
 * パスワードポリシー(新規設定時の最低ライン)の単一の定義。
 *
 * docs/requirements.md にパスワードポリシーの明記が無いため、既存の慣行が無い中での最低ライン
 * として12文字以上とした。招待受諾(routes/invitations.ts)・パスワードリセット
 * (routes/password-resets.ts)・セルフサインアップ(routes/signup.ts)が同じ関数を使う
 * (以前は前2者が同じ定数を各ファイルに持っていた。3箇所目が増えるのでここへ集約した)。
 */

export const MIN_PASSWORD_LENGTH = 12;

/** 新しいパスワードとして受け付けられるか(文字列で、最低文字数を満たす)。 */
export function isAcceptablePassword(value: unknown): value is string {
  return typeof value === "string" && value.length >= MIN_PASSWORD_LENGTH;
}
