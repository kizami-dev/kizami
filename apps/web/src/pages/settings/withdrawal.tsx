import { TenantWithdrawalView } from "../../components/TenantWithdrawalView";

export default async function SettingsWithdrawalPage() {
  return <TenantWithdrawalView />;
}

export const getConfig = async () => {
  return { render: "static" } as const;
};
