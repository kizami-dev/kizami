import { SettingsAttendanceView } from "../../components/SettingsAttendanceView";

export default async function SettingsAttendancePage() {
  return <SettingsAttendanceView />;
}

export const getConfig = async () => {
  return { render: "static" } as const;
};
