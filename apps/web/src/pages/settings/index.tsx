import { SettingsHubView } from "../../components/SettingsHubView";

export default async function SettingsHubPage() {
  return <SettingsHubView />;
}

export const getConfig = async () => {
  return { render: "static" } as const;
};
