import { NotificationsListView } from "../components/NotificationsListView";

export default async function NotificationsPage() {
  return <NotificationsListView />;
}

export const getConfig = async () => {
  return { render: "static" } as const;
};
