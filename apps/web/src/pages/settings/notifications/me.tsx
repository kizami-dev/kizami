import { PersonalNotificationSettingsView } from "../../../components/PersonalNotificationSettingsView";

export default async function SettingsNotificationsMePage() {
  return <PersonalNotificationSettingsView />;
}

export const getConfig = async () => {
  return { render: "static" } as const;
};
