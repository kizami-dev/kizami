import { PunchHome } from "../components/PunchHome";

export default async function PunchPage() {
  return <PunchHome />;
}

export const getConfig = async () => {
  return { render: "static" } as const;
};
