import { ForgotPasswordForm } from "../components/ForgotPasswordForm";

/**
 * 「パスワードを忘れた」画面(認証ガード無し・公開)。システムメールがある配備でだけ有効で、
 * 有効かどうかは静的書き出しに焼き込まず、画面側が GET /password-resets/config で都度確認する
 * (同じイメージを設定の違う環境で使うため。SignupForm と同じ)。
 */
export default async function ForgotPasswordPage() {
  return <ForgotPasswordForm />;
}

export const getConfig = async () => {
  return { render: "static" } as const;
};
