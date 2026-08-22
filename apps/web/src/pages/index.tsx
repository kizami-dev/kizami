import { DashboardView } from "../components/DashboardView";

export default async function HomePage() {
  return <DashboardView />;
}

export const getConfig = async () => {
  return { render: "static" } as const;
};
