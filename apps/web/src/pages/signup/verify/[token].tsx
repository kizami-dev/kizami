import { SignupVerifyView } from "../../../components/SignupVerifyView";

/**
 * サインアップのメール確認ページ(認証ガード無し・公開)。招待受諾ページ(pages/invite/[token].tsx)と
 * 同じ理由で、token は事前生成できない動的な値なので render: "dynamic" を使う。
 */
export default async function SignupVerifyPage({ token }: { token: string }) {
  return <SignupVerifyView token={token} />;
}

export const getConfig = async () => {
  return { render: "dynamic" } as const;
};
