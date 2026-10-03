import { SignupForm } from "../components/SignupForm";

/**
 * セルフサインアップ画面(認証ガード無し・公開、KIZAMI Cloud)。
 * モード(off / invite / open)は静的書き出しに焼き込まず、画面側が GET /signup/config で
 * 都度確認する(同じイメージを SIGNUP_MODE の違う環境で使うため)。
 */
export default async function SignupPage() {
  return <SignupForm />;
}

export const getConfig = async () => {
  return { render: "static" } as const;
};
