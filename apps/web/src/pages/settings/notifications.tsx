import { SettingsNotificationsView } from "../../components/SettingsNotificationsView";

export default async function SettingsNotificationsPage() {
  return <SettingsNotificationsView />;
}

export const getConfig = async () => {
  return { render: "static" } as const;
};
