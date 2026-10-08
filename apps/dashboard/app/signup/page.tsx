import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { configuredProviders, getSessionUser, SESSION_COOKIE } from "@calder/auth";
import { SignupForm } from "./signup-form";
import { AuthShell } from "../../components/auth-shell";

export const metadata = {
  title: "Create your Calder account",
};

export default async function SignupPage() {
  const cookieStore = await cookies();
  if (await getSessionUser(cookieStore.get(SESSION_COOKIE)?.value)) redirect("/");
  const providers = configuredProviders();

  return (
    <AuthShell switchHref="/login" switchLabel="Sign in">
      <SignupForm providers={providers} />
    </AuthShell>
  );
}
