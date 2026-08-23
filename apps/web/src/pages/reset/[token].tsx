import { PasswordResetAcceptView } from "../../components/PasswordResetAcceptView";

/**
 * パスワードリセット受諾ページ(認証ガード無し・公開)。pages/invite/[token].tsx と同じ理由
 * (token は無限に発行され得る動的な値)で render: "dynamic" を使う。
 */
export default async function PasswordResetPage({ token }: { token: string }) {
  return <PasswordResetAcceptView token={token} />;
}

export const getConfig = async () => {
  return { render: "dynamic" } as const;
};
