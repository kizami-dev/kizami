import { SettingsSlackView } from "../../components/SettingsSlackView";

export default async function SettingsSlackPage() {
  return <SettingsSlackView />;
}

export const getConfig = async () => {
  return { render: "static" } as const;
};
