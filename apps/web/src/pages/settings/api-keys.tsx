import { ApiKeysSettingsView } from "../../components/ApiKeysSettingsView";

export default async function SettingsApiKeysPage() {
  return <ApiKeysSettingsView />;
}

export const getConfig = async () => {
  return { render: "static" } as const;
};
