import { SettingsSsoView } from "../../components/SettingsSsoView";

export default async function SettingsSsoPage() {
  return <SettingsSsoView />;
}

export const getConfig = async () => {
  return { render: "static" } as const;
};
