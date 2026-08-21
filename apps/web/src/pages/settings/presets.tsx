import { PresetsView } from "../../components/PresetsView";

export default async function SettingsPresetsPage() {
  return <PresetsView />;
}

export const getConfig = async () => {
  return { render: "static" } as const;
};
