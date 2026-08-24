import { SettingsApprovalFlowView } from "../../components/SettingsApprovalFlowView";

export default async function SettingsApprovalFlowPage() {
  return <SettingsApprovalFlowView />;
}

export const getConfig = async () => {
  return { render: "static" } as const;
};
