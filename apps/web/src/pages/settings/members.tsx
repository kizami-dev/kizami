import { MembersView } from "../../components/MembersView";

export default async function SettingsMembersPage() {
  return <MembersView />;
}

export const getConfig = async () => {
  return { render: "static" } as const;
};
