import { LoginForm } from "../components/LoginForm";

export default async function LoginPage() {
  return <LoginForm />;
}

export const getConfig = async () => {
  return { render: "static" } as const;
};
