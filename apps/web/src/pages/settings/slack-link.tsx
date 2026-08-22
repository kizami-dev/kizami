import { SlackLinkView } from "../../components/SlackLinkView";

export default async function SettingsSlackLinkPage() {
  return <SlackLinkView />;
}

export const getConfig = async () => {
  return { render: "static" } as const;
};
