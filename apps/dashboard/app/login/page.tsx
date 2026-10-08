import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { configuredProviders, getSessionUser, SESSION_COOKIE } from "@calder/auth";
import { LoginForm } from "./login-form";
import { AuthShell } from "../../components/auth-shell";

export const metadata = {
  title: "Sign in to Calder",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams?: Promise<{ error?: string }>;
}) {
  const cookieStore = await cookies();
  if (await getSessionUser(cookieStore.get(SESSION_COOKIE)?.value)) redirect("/");
  const query = await searchParams;
  const providers = configuredProviders();
  const devLogin = process.env.NODE_ENV !== "production" && process.env.ALLOW_DEV_LOGIN === "true";

  return (
    <AuthShell switchHref="/signup" switchLabel="Create account">
      <LoginForm providers={providers} initialError={query?.error} devLogin={devLogin} />
    </AuthShell>
  );
}
