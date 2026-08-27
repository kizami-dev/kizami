import { SecuritySettingsView } from "../../components/SecuritySettingsView";

export default async function SettingsSecurityPage() {
  return <SecuritySettingsView />;
}

export const getConfig = async () => {
  return { render: "static" } as const;
};
