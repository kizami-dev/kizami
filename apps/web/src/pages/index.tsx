import { PunchHome } from "../components/PunchHome";

export default async function HomePage() {
  return <PunchHome />;
}

export const getConfig = async () => {
  return { render: "static" } as const;
};
