import { AuditLogsView } from "../../components/AuditLogsView";

export default async function SettingsAuditLogsPage() {
  return <AuditLogsView />;
}

export const getConfig = async () => {
  return { render: "static" } as const;
};
