import { DisplaySettingsView } from "../../components/DisplaySettingsView";

export default async function SettingsDisplayPage() {
  return <DisplaySettingsView />;
}

export const getConfig = async () => {
  return { render: "static" } as const;
};
