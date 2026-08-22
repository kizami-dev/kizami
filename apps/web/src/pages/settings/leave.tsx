import { LeaveSettingsView } from "../../components/LeaveSettingsView";

export default async function SettingsLeavePage() {
  return <LeaveSettingsView />;
}

export const getConfig = async () => {
  return { render: "static" } as const;
};
