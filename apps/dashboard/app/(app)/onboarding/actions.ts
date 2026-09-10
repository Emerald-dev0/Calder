"use server";

import { randomUUID } from "node:crypto";
import { resolveTxt } from "node:dns/promises";
import { eq, and } from "drizzle-orm";
import {
  getDb,
  organizations,
  organizationMembers,
  projects,
  apiKeys,
  domains,
  emails,
  users,
  projectTransports,
  type ProjectMetadata,
} from "@calder/db";
import { generateApiKey } from "@calder/auth";
import { getConfig } from "@calder/config";
import { getTenantContext } from "../../../lib/auth";
import { slugify, type Environment } from "../../../lib/onboarding";

function rid(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

export interface ProfileInput {
  name: string;
  username: string;
  role: string;
  referralSource: string;
  discoveryDetail?: string;
  projectTypes?: string[];
  primaryGoal?: string;
}

/** Onboarding milestone → audit trail. Funnel analytics without a vendor. */
export async function recordMilestone(
  db: ReturnType<typeof getDb>,
  entry: { organizationId?: string | null; actorUserId?: string; action: string; targetId?: string }
): Promise<void> {
  try {
    const { auditLogs } = await import("@calder/db");
    const { randomUUID } = await import("node:crypto");
    await db.insert(auditLogs).values({
      id: `audit_${randomUUID().replace(/-/g, "").slice(0, 24)}`,
      organizationId: entry.organizationId ?? null,
      actorUserId: entry.actorUserId,
      action: entry.action,
      targetType: "onboarding",
      targetId: entry.targetId,
    });
  } catch {
    // Milestones must never break onboarding.
  }
}

/** Step 0: who are you. Username unique (case-insensitive); returns field errors. */
export async function saveProfile(input: ProfileInput) {
  const ctx = await getTenantContext();
  const name = input.name.trim().slice(0, 100);
  const username = input.username.toLowerCase().trim();
  if (name.length < 2) throw new Error("Tell us your name (2+ characters).");
  if (!/^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?$/.test(username)) {
    throw new Error("Username: lowercase letters, numbers, hyphens (max 39).");
  }
  const db = getDb();
  const taken = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.username, username))
    .limit(1);
  if (taken[0] && taken[0].id !== ctx.user.userId) {
    throw new Error("That username is taken, try another.");
  }
  await db
    .update(users)
    .set({
      name,
      username,
      role: input.role.slice(0, 32),
      referralSource: input.referralSource.slice(0, 100),
      discoveryDetail: (input.discoveryDetail ?? "").slice(0, 100) || null,
      projectTypes: (input.projectTypes ?? []).slice(0, 9),
      primaryGoal: (input.primaryGoal ?? "").slice(0, 50) || null,
      onboardingState: "profile_in_progress",
      updatedAt: new Date(),
    })
    .where(eq(users.id, ctx.user.userId));
  await recordMilestone(db, {
    actorUserId: ctx.user.userId,
    action: "onboarding.profile_completed",
  });
  return { ok: true as const };
}

/** Mark the whole flow done (enables the dashboard's full nav later). */
export async function completeOnboarding() {
  const ctx = await getTenantContext();
  const db = getDb();
  await db
    .update(users)
    .set({ onboardingCompletedAt: new Date(), onboardingState: "completed", updatedAt: new Date() })
    .where(eq(users.id, ctx.user.userId));
  await recordMilestone(db, { actorUserId: ctx.user.userId, action: "onboarding.completed" });
  return { ok: true as const };
}

async function membershipOrgIds(userId: string): Promise<Set<string>> {
  const db = getDb();
  const rows = await db
    .select({ orgId: organizationMembers.organizationId })
    .from(organizationMembers)
    .where(eq(organizationMembers.userId, userId));
  return new Set(rows.map((r) => r.orgId));
}

export async function assertProjectAccess(projectId: string) {
  const ctx = await getTenantContext();
  const projectIds = new Set(ctx.memberships.flatMap((m) => m.projects.map((p) => p.id)));
  if (!projectIds.has(projectId)) throw new Error("Project not found.");
  return ctx;
}

export async function createOrganization(name: string) {
  const ctx = await getTenantContext();
  const clean = name.trim().slice(0, 100);
  if (clean.length < 2) throw new Error("Give your organization a name (2+ characters).");
  const db = getDb();
  let slug = slugify(clean) || "org";
  for (let i = 0; i < 5; i++) {
    const candidate = i === 0 ? slug : `${slug}-${i + 1}`;
    const taken = await db
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.slug, candidate))
      .limit(1);
    if (!taken[0]) {
      slug = candidate;
      break;
    }
  }
  const orgId = rid("org");
  await db.insert(organizations).values({ id: orgId, name: clean, slug });
  await db.insert(organizationMembers).values({
    id: rid("orgm"),
    organizationId: orgId,
    userId: ctx.user.userId,
    role: "owner",
  });
  await db
    .update(users)
    .set({ onboardingState: "technical_in_progress", updatedAt: new Date() })
    .where(eq(users.id, ctx.user.userId));
  await recordMilestone(db, {
    organizationId: orgId,
    actorUserId: ctx.user.userId,
    action: "onboarding.organization_created",
    targetId: orgId,
  });
  return { orgId, slug, name: clean };
}

export async function createProject(input: {
  orgId: string;
  name: string;
  environment: Environment;
  useCases: string[];
  volume: string;
}) {
  const ctx = await getTenantContext();
  const orgIds = await membershipOrgIds(ctx.user.userId);
  if (!orgIds.has(input.orgId)) throw new Error("Organization not found.");
  const clean = input.name.trim().slice(0, 100);
  if (clean.length < 2) throw new Error("Give your project a name (2+ characters).");
  const metadata: ProjectMetadata = {
    environment: input.environment,
    useCases: input.useCases.slice(0, 6),
    monthlyVolume: input.volume,
  };
  const db = getDb();
  let slug = slugify(clean) || "project";
  for (let i = 0; i < 5; i++) {
    const candidate = i === 0 ? slug : `${slug}-${i + 1}`;
    const taken = await db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.organizationId, input.orgId), eq(projects.slug, candidate)))
      .limit(1);
    if (!taken[0]) {
      slug = candidate;
      break;
    }
  }
  const projectId = rid("proj");
  await db.insert(projects).values({
    id: projectId,
    organizationId: input.orgId,
    name: clean,
    slug,
    metadata,
  });
  await recordMilestone(db, {
    organizationId: input.orgId,
    actorUserId: ctx.user.userId,
    action: "onboarding.project_created",
    targetId: projectId,
  });
  return { projectId, slug, name: clean };
}

export async function createTestKey(projectId: string, name: string) {
  await assertProjectAccess(projectId);
  const clean = name.trim().slice(0, 100) || "onboarding key";
  const generated = generateApiKey("test");
  const db = getDb();
  const id = rid("key");
  await db.insert(apiKeys).values({
    id,
    projectId,
    name: clean,
    keyPrefix: generated.prefix,
    keyHash: generated.hash,
    env: "test",
  });
  // Secret returned ONCE, caller must display and discard.
  return { id, secret: generated.secret, prefix: generated.prefix };
}

export async function listTestKeys(projectId: string) {
  await assertProjectAccess(projectId);
  const db = getDb();
  const rows = await db
    .select({
      id: apiKeys.id,
      name: apiKeys.name,
      prefix: apiKeys.keyPrefix,
      revokedAt: apiKeys.revokedAt,
      createdAt: apiKeys.createdAt,
    })
    .from(apiKeys)
    .where(eq(apiKeys.projectId, projectId));
  return rows.map((r) => ({ ...r, revokedAt: r.revokedAt?.toISOString() ?? null }));
}

/**
 * Non-secret transport status for the sending-setup step. Never returns
 * credentials; the worker decrypts at send time.
 */
export async function listTransports(projectId: string) {
  await assertProjectAccess(projectId);
  const db = getDb();
  return db
    .select({
      id: projectTransports.id,
      type: projectTransports.type,
      label: projectTransports.label,
      status: projectTransports.status,
      isDefault: projectTransports.isDefault,
      dailyCap: projectTransports.dailyCap,
    })
    .from(projectTransports)
    .where(eq(projectTransports.projectId, projectId));
}

export async function sendFirstEmail(input: { projectId: string; keySecret: string; to: string }) {
  await assertProjectAccess(input.projectId);
  if (!input.to.includes("@")) throw new Error("Enter a valid recipient address.");
  const base = getConfig().API_URL.replace(/\/$/, "");
  const res = await fetch(`${base}/v1/emails`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.keySecret}`,
      "Idempotency-Key": `onboarding-first-${input.projectId}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "welcome@calder.click",
      to: input.to,
      subject: "Your first Calder email worked",
      text: "If you're reading this, your pipeline is live: validated, queued, sent, delivered.",
    }),
  });
  const body = (await res.json().catch(() => null)) as {
    id?: string;
    error?: { message?: string };
  } | null;
  if (!res.ok || !body?.id) {
    throw new Error(body?.error?.message ?? `Send failed (HTTP ${res.status}).`);
  }
  const ctx = await getTenantContext();
  const db = getDb();
  await recordMilestone(db, {
    actorUserId: ctx.user.userId,
    action: "onboarding.first_send_accepted",
    targetId: body.id,
  });
  return { emailId: body.id };
}

export async function getEmailStatus(input: { projectId: string; emailId: string }) {
  await assertProjectAccess(input.projectId);
  const db = getDb();
  const rows = await db
    .select({ status: emails.status })
    .from(emails)
    .where(eq(emails.id, input.emailId))
    .limit(1);
  const row = rows[0];
  if (!row) throw new Error("Email not found.");
  return { status: row.status };
}

export interface DnsRecord {
  type: string;
  host: string;
  value: string;
  purpose: string;
}

export async function addDomain(projectId: string, domain: string) {
  await assertProjectAccess(projectId);
  const clean = domain.toLowerCase().trim();
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(clean))
    throw new Error("Enter a valid domain (e.g. acme.com).");
  const token = randomUUID().replace(/-/g, "").slice(0, 32);
  const db = getDb();
  const id = rid("dom");
  try {
    await db.insert(domains).values({
      id,
      projectId,
      domain: clean,
      status: "pending",
      verificationMethod: "dns",
      verificationToken: token,
    });
  } catch (err: unknown) {
    if (err instanceof Error && "code" in err && (err as { code: string }).code === "23505") {
      throw new Error("That domain is already on this project.");
    }
    throw err;
  }
  const records: DnsRecord[] = [
    {
      type: "TXT",
      host: `_calder.${clean}`,
      value: `calder_verify_${token}`,
      purpose: "Proves you control the domain",
    },
    {
      type: "TXT",
      host: clean,
      value: "v=spf1 include:_spf.calder.click ~all",
      purpose: "Authorizes Calder to send",
    },
    {
      type: "TXT",
      host: `_dmarc.${clean}`,
      value: "v=DMARC1; p=none; rua=mailto:dmarc@calder.click",
      purpose: "Abuse reporting policy",
    },
  ];
  return { domainId: id, records };
}

export async function checkDomainDns(domainId: string) {
  const ctx = await getTenantContext();
  const db = getDb();
  const projectIds = new Set(ctx.memberships.flatMap((m) => m.projects.map((p) => p.id)));
  const rows = await db.select().from(domains).where(eq(domains.id, domainId)).limit(1);
  const row = rows[0];
  if (!row || !projectIds.has(row.projectId)) throw new Error("Domain not found.");
  if (!row.verificationToken) throw new Error("No verification token on this domain.");
  // Check current host first, then the pre-rebrand legacy host, tokens issued
  // under either prefix verify forever.
  let flat = "";
  for (const host of [`_calder.${row.domain}`, `_avenor.${row.domain}`]) {
    try {
      const records: string[][] = await resolveTxt(host);
      flat += records.flat().join(" ");
    } catch {
      // No record at this host, try the next.
    }
  }
  if (!flat) {
    return { verified: false, detail: "No TXT record found yet, DNS may still be propagating." };
  }
  if (
    flat.includes(`calder_verify_${row.verificationToken}`) ||
    flat.includes(`avenor_verify_${row.verificationToken}`)
  ) {
    await db
      .update(domains)
      .set({ status: "verified", verifiedAt: new Date() })
      .where(eq(domains.id, domainId));
    return { verified: true, detail: "Token found. Domain verified." };
  }
  return { verified: false, detail: "TXT record exists but the token doesn't match." };
}
