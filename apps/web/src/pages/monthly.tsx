import { MonthlyView } from "../components/MonthlyView";

export default async function MonthlyPage() {
  return <MonthlyView />;
}

export const getConfig = async () => {
  return { render: "static" } as const;
};
