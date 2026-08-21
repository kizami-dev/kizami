import { CorrectionsView } from "../components/CorrectionsView";

export default async function CorrectionsPage() {
  return <CorrectionsView />;
}

export const getConfig = async () => {
  return { render: "static" } as const;
};
