import { Suspense } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { eq, inArray, count, isNull, and } from "drizzle-orm";
import { getConfig } from "@calder/config";
import { getDb, users, emails, domains, apiKeys } from "@calder/db";
import { getTenantContext } from "../../lib/auth";
import { OnboardingGate } from "../../components/onboarding-gate";
import { AppShell } from "../../components/app-shell";

function isFounder(email: string): boolean {
  const founders = (getConfig().FOUNDER_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return founders.includes(email.toLowerCase());
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getTenantContext();
  const db = getDb();
  const [me] = await db
    .select({
      name: users.name,
      onboardingCompletedAt: users.onboardingCompletedAt,
      onboardingState: users.onboardingState,
    })
    .from(users)
    .where(eq(users.id, ctx.user.userId))
    .limit(1);
  const onboardingComplete =
    Boolean(me?.onboardingCompletedAt) || me?.onboardingState === "completed";
  const onboardingPaused = cookies().get("calder_onboarding_paused")?.value === "1";
  if (!onboardingComplete && !onboardingPaused) {
    redirect("/onboarding");
  }

  const showAdmin = isFounder(ctx.user.email);
  const memberships = ctx.memberships.map((m) => ({
    organization: { id: m.organization.id, name: m.organization.name, slug: m.organization.slug },
    role: m.role,
    projects: m.projects.map((p) => ({
      id: p.id,
      name: p.name,
      slug: p.slug,
      environment: p.metadata?.environment ?? "development",
    })),
  }));

  const projectIds = memberships.flatMap((m) => m.projects.map((p) => p.id));
  let sentThisMonth = 0;
  let verifiedDomains = 0;
  let activeKeys = 0;

  if (projectIds.length > 0) {
    const [emailRow] = await db
      .select({ value: count() })
      .from(emails)
      .where(inArray(emails.projectId, projectIds));
    sentThisMonth = emailRow?.value ?? 0;

    const [domRow] = await db
      .select({ value: count() })
      .from(domains)
      .where(and(inArray(domains.projectId, projectIds), eq(domains.status, "verified")));
    verifiedDomains = domRow?.value ?? 0;

    const [keyRow] = await db
      .select({ value: count() })
      .from(apiKeys)
      .where(and(inArray(apiKeys.projectId, projectIds), isNull(apiKeys.revokedAt)));
    activeKeys = keyRow?.value ?? 0;
  }

  return (
    <>
      <OnboardingGate
        orgCount={ctx.memberships.length}
        incomplete={!onboardingComplete && !onboardingPaused}
      />
      <Suspense fallback={null}>
        <AppShell
          user={{
            userId: ctx.user.userId,
            email: ctx.user.email,
            name: me?.name ?? null,
          }}
          memberships={memberships}
          showAdmin={showAdmin}
          usageSummary={{
            sentThisMonth,
            monthlyQuota: 5000,
            planName: "Free",
            verifiedDomains,
            activeKeys,
          }}
        >
          {children}
        </AppShell>
      </Suspense>
    </>
  );
}
