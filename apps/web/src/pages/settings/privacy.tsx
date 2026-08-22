import { PrivacyTemplatesView } from "../../components/PrivacyTemplatesView";

export default async function SettingsPrivacyPage() {
  return <PrivacyTemplatesView />;
}

export const getConfig = async () => {
  return { render: "static" } as const;
};
