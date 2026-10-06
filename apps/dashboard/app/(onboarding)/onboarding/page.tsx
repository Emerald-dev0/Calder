export const metadata = {
  title: "Calder — Setup",
};

import { redirect } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import {
  getDb,
  users,
  domains,
  emails,
  projectTransports,
  expectedTxtHost,
  expectedTxtValue,
} from "@calder/db";
import { getTenantContext } from "../../../lib/auth";
import { resolveInitialOnboardingStep } from "../../../lib/onboarding";
import type { DnsRecord } from "../../(app)/onboarding/actions";
import { OnboardingWizard } from "./wizard";

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams?: Promise<{ notice?: string }>;
}) {
  const query = await searchParams;
  const ctx = await getTenantContext();
  const db = getDb();
  const rows = await db.select().from(users).where(eq(users.id, ctx.user.userId)).limit(1);
  const me = rows[0];

  // Users who finished onboarding are redirected out to the dashboard.
  if (me?.onboardingCompletedAt || me?.onboardingState === "completed") {
    redirect("/");
  }

  const firstMembership = ctx.memberships[0];
  const firstOrg = firstMembership?.organization ?? null;
  const firstProject = firstMembership?.projects[0] ?? null;

  const hasOrg = Boolean(firstOrg);
  const hasProject = Boolean(firstProject);

  let initialDomain: {
    id: string;
    domain: string;
    status: "pending" | "verified";
    records: DnsRecord[];
  } | null = null;

  let initialTransports: Array<{
    id: string;
    type: string;
    label: string;
    status: string;
    isDefault: boolean;
    dailyCap: number | null;
  }> = [];

  let initialEmail: {
    id: string;
    to: string;
    subject: string;
    text: string;
    status: string;
  } | null = null;

  if (firstProject) {
    const [domRows, transportRows, emailRows] = await Promise.all([
      db
        .select()
        .from(domains)
        .where(eq(domains.projectId, firstProject.id))
        .orderBy(desc(domains.createdAt))
        .limit(1),
      db
        .select({
          id: projectTransports.id,
          type: projectTransports.type,
          label: projectTransports.label,
          status: projectTransports.status,
          isDefault: projectTransports.isDefault,
          dailyCap: projectTransports.dailyCap,
        })
        .from(projectTransports)
        .where(eq(projectTransports.projectId, firstProject.id)),
      db
        .select()
        .from(emails)
        .where(eq(emails.projectId, firstProject.id))
        .orderBy(desc(emails.createdAt))
        .limit(1),
    ]);

    const dom = domRows[0];
    if (dom) {
      const token = dom.verificationToken ?? "";
      initialDomain = {
        id: dom.id,
        domain: dom.domain,
        status: dom.status === "verified" ? "verified" : "pending",
        records: token
          ? [
              {
                type: "TXT",
                host: expectedTxtHost(dom.domain),
                value: expectedTxtValue(token),
                purpose:
                  "Ownership verification record. Publish at your DNS provider, then check verification status below.",
              },
              {
                type: "TXT",
                host: dom.domain,
                value: "v=spf1 include:amazonses.com ~all",
                purpose:
                  "SPF authorization record so receiving servers trust Calder's dispatchers.",
              },
            ]
          : [],
      };
    }

    initialTransports = transportRows;

    const latestEmail = emailRows[0];
    if (latestEmail) {
      initialEmail = {
        id: latestEmail.id,
        to: latestEmail.to,
        subject: latestEmail.subject,
        text:
          latestEmail.text ??
          "If you're reading this, your pipeline is live: validated, queued, sent, delivered.",
        status: latestEmail.status,
      };
    }
  }

  const initialStep = resolveInitialOnboardingStep({
    onboardingState: me?.onboardingState,
    hasUsername: Boolean(me?.username),
    hasOrg,
    hasProject,
    notice: query?.notice ?? null,
  });

  return (
    <OnboardingWizard
      userEmail={ctx.user.email}
      initialStep={initialStep}
      initialNotice={query?.notice ?? null}
      initialProfile={{
        name: me?.name ?? "",
        username: me?.username ?? "",
        role: me?.role ?? "Developer",
      }}
      initialOrg={
        firstOrg
          ? {
              id: firstOrg.id,
              name: firstOrg.name,
              slug: firstOrg.slug,
            }
          : null
      }
      initialProject={
        firstProject
          ? {
              id: firstProject.id,
              name: firstProject.name,
              slug: firstProject.slug,
            }
          : null
      }
      initialDomain={initialDomain}
      initialTransports={initialTransports}
      initialEmail={initialEmail}
    />
  );
}
