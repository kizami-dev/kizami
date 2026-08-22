import { LeaveHome } from "../components/LeaveHome";

export default async function LeavePage() {
  return <LeaveHome />;
}

export const getConfig = async () => {
  return { render: "static" } as const;
};
