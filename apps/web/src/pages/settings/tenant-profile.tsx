import { SettingsTenantProfileView } from "../../components/SettingsTenantProfileView";

export default async function SettingsTenantProfilePage() {
  return <SettingsTenantProfileView />;
}

export const getConfig = async () => {
  return { render: "static" } as const;
};
