import { SettingsAllowancesView } from "../../components/SettingsAllowancesView";

export default async function SettingsAllowancesPage() {
  return <SettingsAllowancesView />;
}

export const getConfig = async () => {
  return { render: "static" } as const;
};
