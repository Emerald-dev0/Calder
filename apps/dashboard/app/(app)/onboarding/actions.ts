"use server";

import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { and, eq, inArray } from "drizzle-orm";
import {
  getDb,
  organizations,
  organizationMembers,
  projects,
  apiKeys,
  domains,
  emails,
  emailEvents,
  users,
  projectTransports,
  recordSendUsage,
  type ProjectMetadata,
} from "@calder/db";
import { generateApiKey } from "@calder/auth";
import { getConfig } from "@calder/config";
import { getTenantContext } from "../../../lib/auth";
import {
  slugify,
  isValidSlug,
  isValidUsername,
  type Environment,
  type SendingSetupMode,
} from "../../../lib/onboarding";

const ONBOARDING_PAUSED_COOKIE = "calder_onboarding_paused";

function rid(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

export interface ProfileInput {
  name: string;
  username: string;
  role: string;
  referralSource?: string;
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

/** Live debounced username availability check on Screen 2 (Profile). */
export async function checkUsernameAvailability(rawUsername: string): Promise<{
  available: boolean;
  valid: boolean;
  normalized: string;
  message: string;
}> {
  const ctx = await getTenantContext();
  const normalized = rawUsername.toLowerCase().trim();
  if (normalized.length < 2) {
    return {
      available: false,
      valid: false,
      normalized,
      message: "Username must be at least 2 characters.",
    };
  }
  if (!isValidUsername(normalized)) {
    return {
      available: false,
      valid: false,
      normalized,
      message: "Use lowercase letters, numbers, and internal hyphens (max 39).",
    };
  }
  const db = getDb();
  const taken = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.username, normalized))
    .limit(1);
  if (taken[0] && taken[0].id !== ctx.user.userId) {
    return {
      available: false,
      valid: true,
      normalized,
      message: `@${normalized} is already taken.`,
    };
  }
  return {
    available: true,
    valid: true,
    normalized,
    message: `@${normalized} is available.`,
  };
}

/** Persist the exact step (1..6) so refreshing or returning resumes there. */
export async function saveOnboardingStep(step: number) {
  const ctx = await getTenantContext();
  const clamped = Math.max(1, Math.min(6, Math.round(step)));
  const db = getDb();
  await db
    .update(users)
    .set({
      onboardingState: `step_${clamped}`,
      updatedAt: new Date(),
    })
    .where(eq(users.id, ctx.user.userId));
  try {
    (await cookies()).delete(ONBOARDING_PAUSED_COOKIE);
  } catch {
    // ignore cookie mutation errors if called outside action context
  }
  return { ok: true as const, step: clamped };
}

/**
 * Save current step progress (plus any valid partial profile fields) and set a
 * session bypass cookie so the user can exit to the dashboard without a redirect
 * loop. Returning to /onboarding later resumes at the exact saved step.
 */
export async function saveAndExitOnboarding(input: {
  step: number;
  name?: string;
  username?: string;
  role?: string;
}) {
  const ctx = await getTenantContext();
  const clamped = Math.max(1, Math.min(6, Math.round(input.step)));
  const db = getDb();

  const patch: Record<string, unknown> = {
    onboardingState: `step_${clamped}`,
    updatedAt: new Date(),
  };

  if (input.name && input.name.trim().length >= 2) {
    patch.name = input.name.trim().slice(0, 100);
  }
  if (input.role && input.role.trim().length > 0) {
    patch.role = input.role.trim().slice(0, 32);
  }
  if (input.username) {
    const cleanUser = input.username.toLowerCase().trim();
    if (cleanUser.length >= 2 && isValidUsername(cleanUser)) {
      const taken = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.username, cleanUser))
        .limit(1);
      if (!taken[0] || taken[0].id === ctx.user.userId) {
        patch.username = cleanUser;
      }
    }
  }

  await db.update(users).set(patch).where(eq(users.id, ctx.user.userId));
  await recordMilestone(db, {
    actorUserId: ctx.user.userId,
    action: "onboarding.saved_and_exited",
    targetId: `step_${clamped}`,
  });

  const secure = process.env.NODE_ENV === "production";
  (await cookies()).set(ONBOARDING_PAUSED_COOKIE, "1", {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure,
    maxAge: 60 * 60 * 12,
  });

  return { ok: true as const };
}

/** Step 2: Profile (name, unique lowercase username, role). */
export async function saveProfile(input: ProfileInput) {
  const ctx = await getTenantContext();
  const name = input.name.trim().slice(0, 100);
  const username = input.username.toLowerCase().trim();
  if (name.length < 2) throw new Error("Enter your name (at least 2 characters).");
  if (username.length < 2 || !isValidUsername(username)) {
    throw new Error("Username must be 2–39 lowercase letters, numbers, or internal hyphens.");
  }
  if (!input.role || !input.role.trim()) {
    throw new Error("Select the role that best describes you.");
  }
  const db = getDb();
  const taken = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.username, username))
    .limit(1);
  if (taken[0] && taken[0].id !== ctx.user.userId) {
    throw new Error(`@${username} is already taken. Try another username.`);
  }
  await db
    .update(users)
    .set({
      name,
      username,
      role: input.role.slice(0, 32),
      referralSource: (input.referralSource ?? "").slice(0, 100) || null,
      discoveryDetail: (input.discoveryDetail ?? "").slice(0, 100) || null,
      projectTypes: (input.projectTypes ?? []).slice(0, 9),
      primaryGoal: (input.primaryGoal ?? "").slice(0, 50) || null,
      onboardingState: "step_3",
      updatedAt: new Date(),
    })
    .where(eq(users.id, ctx.user.userId));
  await recordMilestone(db, {
    actorUserId: ctx.user.userId,
    action: "onboarding.profile_completed",
  });
  return { ok: true as const };
}

/** Mark the whole flow done (enables the dashboard's full nav). */
export async function completeOnboarding() {
  const ctx = await getTenantContext();
  const db = getDb();
  await db
    .update(users)
    .set({ onboardingCompletedAt: new Date(), onboardingState: "completed", updatedAt: new Date() })
    .where(eq(users.id, ctx.user.userId));
  await recordMilestone(db, { actorUserId: ctx.user.userId, action: "onboarding.completed" });
  try {
    (await cookies()).delete(ONBOARDING_PAUSED_COOKIE);
  } catch {
    // ignore
  }
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
  const membership = ctx.memberships.find((m) => m.projects.some((p) => p.id === projectId));
  if (!membership) throw new Error("Project not found.");
  return ctx;
}

/** Project mutations require an organization owner/admin, not mere visibility. */
export async function assertProjectManager(projectId: string) {
  const ctx = await assertProjectAccess(projectId);
  const membership = ctx.memberships.find((m) => m.projects.some((p) => p.id === projectId));
  if (!membership || (membership.role !== "owner" && membership.role !== "admin")) {
    throw new Error("Only organization owners or admins can manage this project.");
  }
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
    .set({ onboardingState: "step_4", updatedAt: new Date() })
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
  const membership = ctx.memberships.find((m) => m.organization.id === input.orgId);
  if (!membership) throw new Error("Organization not found.");
  if (membership.role !== "owner" && membership.role !== "admin") {
    throw new Error("Only organization owners or admins can create projects.");
  }
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

/**
 * Step 3: Combined Organization + first Project creation/update.
 * Idempotent when the user navigates Back and clicks Continue again.
 */
export async function saveOrgAndProjectStep(input: {
  orgId?: string | null;
  orgName: string;
  orgSlug: string;
  projectId?: string | null;
  projectName: string;
}) {
  const ctx = await getTenantContext();
  const cleanOrgName = input.orgName.trim().slice(0, 100);
  const cleanOrgSlug = input.orgSlug.toLowerCase().trim().slice(0, 100);
  const cleanProjectName = input.projectName.trim().slice(0, 100);

  if (cleanOrgName.length < 2) {
    throw new Error("Enter an organization name (at least 2 characters).");
  }
  if (cleanOrgSlug.length < 2 || !isValidSlug(cleanOrgSlug)) {
    throw new Error(
      "Organization slug must be 2–100 lowercase letters, numbers, or internal hyphens."
    );
  }
  if (cleanProjectName.length < 2) {
    throw new Error("Enter a project name (at least 2 characters).");
  }

  const db = getDb();
  const userOrgIds = await membershipOrgIds(ctx.user.userId);

  // Check if slug is already owned by another organization
  const existingBySlug = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(eq(organizations.slug, cleanOrgSlug))
    .limit(1);

  let finalOrgId = input.orgId && userOrgIds.has(input.orgId) ? input.orgId : null;
  if (existingBySlug[0] && existingBySlug[0].id !== finalOrgId) {
    if (userOrgIds.has(existingBySlug[0].id)) {
      finalOrgId = existingBySlug[0].id;
    } else {
      throw new Error(`Slug "${cleanOrgSlug}" is already taken. Try a different slug.`);
    }
  }

  if (finalOrgId) {
    const membership = ctx.memberships.find((m) => m.organization.id === finalOrgId);
    if (!membership || (membership.role !== "owner" && membership.role !== "admin")) {
      throw new Error("Only organization owners or admins can update this workspace.");
    }
    await db
      .update(organizations)
      .set({ name: cleanOrgName, slug: cleanOrgSlug, updatedAt: new Date() })
      .where(eq(organizations.id, finalOrgId));
  } else {
    finalOrgId = rid("org");
    await db.insert(organizations).values({
      id: finalOrgId,
      name: cleanOrgName,
      slug: cleanOrgSlug,
    });
    await db.insert(organizationMembers).values({
      id: rid("orgm"),
      organizationId: finalOrgId,
      userId: ctx.user.userId,
      role: "owner",
    });
    await recordMilestone(db, {
      organizationId: finalOrgId,
      actorUserId: ctx.user.userId,
      action: "onboarding.organization_created",
      targetId: finalOrgId,
    });
  }

  // Create or update first project inside this organization
  const existingProjects = await db
    .select()
    .from(projects)
    .where(eq(projects.organizationId, finalOrgId));

  const matchedProject =
    (input.projectId ? existingProjects.find((p) => p.id === input.projectId) : undefined) ??
    existingProjects[0];

  let finalProjectId: string;
  let finalProjectSlug = slugify(cleanProjectName) || "main";

  if (matchedProject) {
    finalProjectId = matchedProject.id;
    // Keep unique slug within org
    const slugCollision = existingProjects.find(
      (p) => p.slug === finalProjectSlug && p.id !== finalProjectId
    );
    if (slugCollision) {
      finalProjectSlug = `${finalProjectSlug}-1`;
    }
    await db
      .update(projects)
      .set({
        name: cleanProjectName,
        slug: finalProjectSlug,
        updatedAt: new Date(),
      })
      .where(and(eq(projects.id, finalProjectId), eq(projects.organizationId, finalOrgId)));
  } else {
    for (let i = 0; i < 5; i++) {
      const candidate = i === 0 ? finalProjectSlug : `${finalProjectSlug}-${i + 1}`;
      if (!existingProjects.some((p) => p.slug === candidate)) {
        finalProjectSlug = candidate;
        break;
      }
    }
    finalProjectId = rid("proj");
    const metadata: ProjectMetadata = {
      environment: "development",
      useCases: ["OTP & verification", "Notifications"],
      monthlyVolume: "< 1k / mo",
    };
    await db.insert(projects).values({
      id: finalProjectId,
      organizationId: finalOrgId,
      name: cleanProjectName,
      slug: finalProjectSlug,
      metadata,
    });
    await recordMilestone(db, {
      organizationId: finalOrgId,
      actorUserId: ctx.user.userId,
      action: "onboarding.project_created",
      targetId: finalProjectId,
    });
  }

  await db
    .update(users)
    .set({ onboardingState: "step_4", updatedAt: new Date() })
    .where(eq(users.id, ctx.user.userId));

  return {
    orgId: finalOrgId,
    orgName: cleanOrgName,
    orgSlug: cleanOrgSlug,
    projectId: finalProjectId,
    projectName: cleanProjectName,
    projectSlug: finalProjectSlug,
  };
}

/** Step 4: Save chosen sending path and advance to Step 5 (First send). */
export async function saveSendingSetupStep(input: { projectId: string; mode: SendingSetupMode }) {
  const ctx = await assertProjectManager(input.projectId);
  const db = getDb();
  await db
    .update(users)
    .set({ onboardingState: "step_5", updatedAt: new Date() })
    .where(eq(users.id, ctx.user.userId));
  await recordMilestone(db, {
    actorUserId: ctx.user.userId,
    action: `onboarding.sending_${input.mode}`,
    targetId: input.projectId,
  });
  return { ok: true as const };
}

export async function createTestKey(projectId: string, name: string) {
  await assertProjectManager(projectId);
  const clean = name.trim().slice(0, 100) || "onboarding key";
  const generated = generateApiKey("test");
  const db = getDb();
  const id = rid("key");
  const { insertApiKeyForActiveOrganization } = await import("@calder/db");
  await insertApiKeyForActiveOrganization(db, projectId, {
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

export async function sendFirstEmail(input: {
  projectId: string;
  keySecret?: string;
  to: string;
  subject?: string;
  text?: string;
}) {
  const ctx = await assertProjectManager(input.projectId);
  const cleanTo = input.to.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanTo)) {
    throw new Error("Enter a valid recipient email address.");
  }
  const cleanSubject = (input.subject ?? "Your first Calder email worked").trim();
  const cleanText = (
    input.text ??
    "If you're reading this, your pipeline is live: validated, queued, sent, delivered."
  ).trim();
  if (!cleanSubject) throw new Error("Add a subject line before sending.");
  if (!cleanText) throw new Error("Add a message body before sending.");

  const db = getDb();
  let secret = input.keySecret;
  if (!secret) {
    const generated = generateApiKey("test");
    const { insertApiKeyForActiveOrganization } = await import("@calder/db");
    await insertApiKeyForActiveOrganization(db, input.projectId, {
      id: rid("key"),
      projectId: input.projectId,
      name: "onboarding test key",
      keyPrefix: generated.prefix,
      keyHash: generated.hash,
      env: "test",
    });
    secret = generated.secret;
  }

  let emailId: string | null = null;
  const base = getConfig().API_URL.replace(/\/$/, "");
  try {
    const res = await fetch(`${base}/v1/emails`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secret}`,
        "Idempotency-Key": `onboarding-first-${input.projectId}-${Date.now()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "welcome@calder.click",
        to: cleanTo,
        subject: cleanSubject,
        text: cleanText,
      }),
    });
    const body = (await res.json().catch(() => null)) as {
      id?: string;
      error?: { message?: string };
    } | null;
    if (res.ok && body?.id) {
      emailId = body.id;
    } else if (res.status >= 400 && res.status < 500 && body?.error?.message) {
      throw new Error(body.error.message);
    }
  } catch (err) {
    // Re-throw validation/client errors; only fall back if the API process is unreachable locally
    if (
      err instanceof Error &&
      !err.message.includes("fetch failed") &&
      !err.message.includes("ECONNREFUSED")
    ) {
      throw err;
    }
  }

  if (!emailId) {
    emailId = `em_${randomUUID().replace(/-/g, "").slice(0, 24)}`;
    const { withProjectSendingEligibility } = await import("@calder/db");
    const admission = await withProjectSendingEligibility(
      db,
      { projectId: input.projectId, env: "test" },
      async (tx) => {
        await tx.insert(emails).values({
          id: emailId!,
          projectId: input.projectId,
          from: "welcome@calder.click",
          to: cleanTo,
          subject: cleanSubject,
          text: cleanText,
          status: "queued",
          env: "test",
        });
        await tx.insert(emailEvents).values({
          id: `ev_${randomUUID().replace(/-/g, "").slice(0, 24)}`,
          emailId: emailId!,
          projectId: input.projectId,
          type: "queued",
          data: { via: "onboarding-first-send" },
        });
        return true;
      }
    );
    if (!admission.allowed) {
      throw new Error("Sending is currently unavailable for this organization.");
    }
    try {
      const { createQueue } = await import("@calder/queue");
      const queue = createQueue<{ emailId: string; projectId: string }>("email:send", {
        maxAttempts: 5,
      });
      await queue.enqueue("send-email", { emailId, projectId: input.projectId });
    } catch {
      // queue optional when drain polls DB
    }
  }

  await db
    .update(users)
    .set({ onboardingState: "step_5", updatedAt: new Date() })
    .where(eq(users.id, ctx.user.userId));

  await recordMilestone(db, {
    actorUserId: ctx.user.userId,
    action: "onboarding.first_send_accepted",
    targetId: emailId,
  });
  return { emailId };
}

export async function getEmailStatus(input: { projectId: string; emailId: string }) {
  await assertProjectAccess(input.projectId);
  const db = getDb();
  const rows = await db
    .select({
      id: emails.id,
      status: emails.status,
      env: emails.env,
      provider: emails.provider,
      createdAt: emails.createdAt,
      updatedAt: emails.updatedAt,
    })
    .from(emails)
    .where(and(eq(emails.id, input.emailId), eq(emails.projectId, input.projectId)))
    .limit(1);
  const row = rows[0];
  if (!row) throw new Error("Email not found.");

  const now = Date.now();
  const ageMs = now - new Date(row.createdAt).getTime();
  const updatedAgeMs = now - new Date(row.updatedAt).getTime();

  // Ensure each live status step (queued → sent → delivered) is observable in real time.
  if (row.status === "queued" || row.status === "sending") {
    if (ageMs < 650) {
      return { status: "queued" as const };
    }
    // Nudge the API drain first
    const base = getConfig().API_URL.replace(/\/$/, "");
    const cronSecret = process.env.CRON_SECRET ?? process.env.ADMIN_API_KEY ?? "";
    await fetch(`${base}/v1/cron/drain`, {
      method: "POST",
      headers: {
        ...(cronSecret ? { authorization: `Bearer ${cronSecret}` } : {}),
        "x-vercel-cron": "1",
      },
    }).catch(() => null);

    const [afterDrain] = await db
      .select({ status: emails.status, provider: emails.provider, env: emails.env })
      .from(emails)
      .where(and(eq(emails.id, input.emailId), eq(emails.projectId, input.projectId)))
      .limit(1);

    if (afterDrain && afterDrain.status !== "queued" && afterDrain.status !== "sending") {
      return { status: afterDrain.status };
    }

    // For test-env onboarding sends where the separate API/worker process wasn't
    // running to drain the row, re-check current org state before simulating the
    // mock provider transition (the worker and drain apply the same gate).
    if (row.env === "test") {
      const { checkProjectSendingEligibility } = await import("@calder/db");
      const currentDecision = await checkProjectSendingEligibility(db, input.projectId, {
        env: "test",
        phase: "delivery",
      });
      if (!currentDecision.allowed) {
        const failedAt = new Date();
        await db
          .update(emails)
          .set({
            status: "failed",
            lastError: "Sending is currently unavailable for this organization.",
            updatedAt: failedAt,
          })
          .where(and(eq(emails.id, row.id), eq(emails.projectId, input.projectId)));
        await db.insert(emailEvents).values({
          id: `ev_${randomUUID().replace(/-/g, "").slice(0, 24)}`,
          emailId: row.id,
          projectId: input.projectId,
          type: "failed",
          data: { code: "organization_sending_unavailable" },
        });
        return { status: "failed" as const };
      }
      const done = new Date();
      const msgId = `mock_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
      await db
        .update(emails)
        .set({
          status: "sent",
          provider: "mock",
          transport: "mock",
          providerMessageId: msgId,
          updatedAt: done,
        })
        .where(and(eq(emails.id, row.id), eq(emails.projectId, input.projectId)));
      await recordSendUsage(db, {
        emailId: row.id,
        projectId: input.projectId,
        env: "test",
        when: done,
      }).catch(() => null);
      await db
        .insert(emailEvents)
        .values({
          id: `ev_${randomUUID().replace(/-/g, "").slice(0, 24)}`,
          emailId: row.id,
          projectId: input.projectId,
          type: "sent",
          data: { provider: "mock", providerMessageId: msgId, transport: "mock" },
        })
        .catch(() => null);
      return { status: "sent" as const };
    }
  }

  if (row.status === "sent" && (row.provider === "mock" || row.env === "test")) {
    if (updatedAgeMs < 650) {
      return { status: "sent" as const };
    }
    const done = new Date();
    await db
      .update(emails)
      .set({ status: "delivered", updatedAt: done })
      .where(and(eq(emails.id, row.id), eq(emails.projectId, input.projectId)));
    await db
      .insert(emailEvents)
      .values({
        id: `ev_${randomUUID().replace(/-/g, "").slice(0, 24)}`,
        emailId: row.id,
        projectId: input.projectId,
        type: "delivered",
        data: { provider: row.provider ?? "mock" },
      })
      .catch(() => null);
    return { status: "delivered" as const };
  }

  return { status: row.status };
}

export interface DnsRecord {
  type: string;
  host: string;
  value: string;
  purpose: string;
}

export async function addDomain(projectId: string, domain: string) {
  await assertProjectManager(projectId);
  const clean = domain.toLowerCase().trim();
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(clean))
    throw new Error("Enter a valid domain (e.g. acme.com).");
  const db = getDb();
  const { createChallenge, expectedTxtHost, expectedTxtValue } = await import("@calder/db");
  const result = await createChallenge(db, {
    projectId,
    domain: clean,
    id: rid("dom"),
  });
  if (result.kind === "cross_tenant")
    throw new Error("This domain is already verified by another organization.");
  if (result.kind === "existing") {
    const [existingRow] = await db
      .select()
      .from(domains)
      .where(and(eq(domains.id, result.id), eq(domains.projectId, projectId)))
      .limit(1);
    const token = existingRow?.verificationToken ?? "";
    return {
      created: false as const,
      id: result.id,
      status: (existingRow?.status as "pending" | "verified") ?? "pending",
      records: token
        ? ([
            {
              type: "TXT",
              host: expectedTxtHost(clean),
              value: expectedTxtValue(token),
              purpose:
                "Ownership verification record. Publish at your DNS provider, then check verification status below.",
            },
            {
              type: "TXT",
              host: clean,
              value: "v=spf1 include:amazonses.com ~all",
              purpose: "SPF authorization record so receiving servers trust Calder's dispatchers.",
            },
          ] as DnsRecord[])
        : ([] as DnsRecord[]),
    };
  }
  return {
    created: true as const,
    id: result.id,
    status: "pending" as const,
    records: [
      {
        type: "TXT",
        host: expectedTxtHost(clean),
        value: expectedTxtValue(result.token),
        purpose:
          "Ownership verification record. Publish at your DNS provider, then check verification status below.",
      },
      {
        type: "TXT",
        host: clean,
        value: "v=spf1 include:amazonses.com ~all",
        purpose: "SPF authorization record so receiving servers trust Calder's dispatchers.",
      },
    ] as DnsRecord[],
  };
}

/** M4.1 wizard check: the shared state machine with its injected TXT oracle. */
export async function checkDomainDns(domainId: string) {
  const ctx = await getTenantContext();
  const db = getDb();
  const projectIds = new Set(ctx.memberships.flatMap((m) => m.projects.map((p) => p.id)));
  const rows = await db
    .select()
    .from(domains)
    .where(and(eq(domains.id, domainId), inArray(domains.projectId, [...projectIds])))
    .limit(1);
  const row = rows[0];
  if (!row || !projectIds.has(row.projectId)) throw new Error("Domain not found.");
  const { attemptVerification } = await import("@calder/db");
  const outcome = await attemptVerification(db, row.projectId, domainId);
  switch (outcome.kind) {
    case "verified":
      return { verified: true as const, detail: "TXT record matched. Domain verified." };
    case "not_found":
      throw new Error("Domain not found.");
    case "expired":
      return {
        verified: false as const,
        detail: "Challenge expired (72h). Mint a fresh token below.",
      };
    case "rate_limited":
      throw new Error(
        `Too many attempts — try again in ${Math.ceil(outcome.retryAfterSec / 60)}m.`
      );
    case "dns_error":
      return { verified: false as const, detail: `DNS lookup failed: ${outcome.message}` };
    case "mismatch":
      return {
        verified: false as const,
        detail:
          outcome.found.length === 0
            ? `No TXT records yet at ${outcome.expected.host} — propagation can take minutes to hours.`
            : `Found TXT records at ${outcome.expected.host} but none match the challenge exactly.`,
      };
    default:
      throw new Error("Unexpected verification outcome");
  }
}

/** M4.1: mint a fresh challenge (expired domains, deliberate rotation). */
export async function regenerateDomainToken(domainId: string) {
  const ctx = await getTenantContext();
  const db = getDb();
  const projectIds = new Set(ctx.memberships.flatMap((m) => m.projects.map((p) => p.id)));
  const [row] = await db
    .select()
    .from(domains)
    .where(and(eq(domains.id, domainId), inArray(domains.projectId, [...projectIds])))
    .limit(1);
  if (!row || !projectIds.has(row.projectId)) throw new Error("Domain not found.");
  await assertProjectManager(row.projectId);
  const { regenerateChallenge, expectedTxtHost, expectedTxtValue } = await import("@calder/db");
  const r = await regenerateChallenge(db, row.projectId, domainId);
  if (r.kind === "not_found") throw new Error("Domain not found.");
  if (r.kind === "verified") throw new Error("Domain already verified.");
  return {
    host: expectedTxtHost(row.domain),
    value: expectedTxtValue(r.token),
    expiresAt: r.expiresAt.toISOString(),
  };
}

/** M4.2: link the verified domain to SES; returns DKIM CNAMEs + SPF guidance. */
export async function linkDomainToSes(domainId: string) {
  const ctx = await getTenantContext();
  const db = getDb();
  const projectIds = new Set(ctx.memberships.flatMap((m) => m.projects.map((p) => p.id)));
  const [row] = await db
    .select()
    .from(domains)
    .where(and(eq(domains.id, domainId), inArray(domains.projectId, [...projectIds])))
    .limit(1);
  if (!row || !projectIds.has(row.projectId)) throw new Error("Domain not found.");
  await assertProjectManager(row.projectId);
  if (row.status !== "verified") throw new Error("Verify DNS ownership first.");
  const { createSesDomainIdentity } = await import("@calder/providers");
  const link = await createSesDomainIdentity(row.domain).catch((e: unknown) => {
    throw new Error(`SES identity creation failed: ${e instanceof Error ? e.message : "unknown"}`);
  });
  await db
    .update(domains)
    .set({
      sesIdentityStatus: "pending",
      dkimStatus: link.dkimStatus,
      dkimRecords: link.records,
      updatedAt: new Date(),
    })
    .where(and(eq(domains.id, domainId), eq(domains.projectId, row.projectId)));
  return {
    records: link.records,
    dkimStatus: link.dkimStatus,
    spf: { name: row.domain, type: "TXT", value: "v=spf1 include:amazonses.com ~all" },
  };
}

/** M4.2: poll SES for DKIM propagation (wizard live polling). */
export async function refreshDomainSesStatus(domainId: string) {
  const ctx = await getTenantContext();
  const db = getDb();
  const projectIds = new Set(ctx.memberships.flatMap((m) => m.projects.map((p) => p.id)));
  const [row] = await db
    .select()
    .from(domains)
    .where(and(eq(domains.id, domainId), inArray(domains.projectId, [...projectIds])))
    .limit(1);
  if (!row || !projectIds.has(row.projectId)) throw new Error("Domain not found.");
  await assertProjectManager(row.projectId);
  const { getSesDomainIdentity } = await import("@calder/providers");
  const snap = await getSesDomainIdentity(row.domain).catch((e: unknown) => {
    throw new Error(`SES status poll failed: ${e instanceof Error ? e.message : "unknown"}`);
  });
  const identityStatus = snap.verifiedForSending ? "verified" : "pending";
  await db
    .update(domains)
    .set({ sesIdentityStatus: identityStatus, dkimStatus: snap.dkimStatus, updatedAt: new Date() })
    .where(and(eq(domains.id, domainId), eq(domains.projectId, row.projectId)));
  return { identityStatus, dkimStatus: snap.dkimStatus };
}
