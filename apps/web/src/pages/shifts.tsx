import { ShiftsView } from "../components/ShiftsView";

export default async function ShiftsPage() {
  return <ShiftsView />;
}

export const getConfig = async () => {
  return { render: "static" } as const;
};
