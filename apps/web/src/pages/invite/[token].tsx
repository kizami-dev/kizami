import { InviteAcceptView } from "../../components/InviteAcceptView";

/**
 * 招待受諾ページ(認証ガード無し・公開)。docs/requirements.md §7「登録は招待式のみ」。
 * token は無限に発行され得る動的な値のため、render: "static" の staticPaths 事前生成ではなく
 * "dynamic" を使う(Waku の fs-router 規約: `[token]` はグループセグメントとして
 * ページコンポーネントへ同名の prop で渡される)。
 */
export default async function InvitePage({ token }: { token: string }) {
  return <InviteAcceptView token={token} />;
}

export const getConfig = async () => {
  return { render: "dynamic" } as const;
};
