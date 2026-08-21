import { DepartmentsView } from "../../components/DepartmentsView";

export default async function SettingsDepartmentsPage() {
  return <DepartmentsView />;
}

export const getConfig = async () => {
  return { render: "static" } as const;
};
