import { HelpSettingsView } from "../../components/HelpSettingsView";

export default async function SettingsHelpPage() {
  return <HelpSettingsView />;
}

export const getConfig = async () => {
  return { render: "static" } as const;
};
