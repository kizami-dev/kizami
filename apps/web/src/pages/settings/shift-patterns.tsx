import { SettingsShiftPatternsView } from "../../components/SettingsShiftPatternsView";

export default async function SettingsShiftPatternsPage() {
  return <SettingsShiftPatternsView />;
}

export const getConfig = async () => {
  return { render: "static" } as const;
};
