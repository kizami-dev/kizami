import { ShiftsMeView } from "../../components/ShiftsMeView";

export default async function ShiftsMePage() {
  return <ShiftsMeView />;
}

export const getConfig = async () => {
  return { render: "static" } as const;
};
