"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { getTenantContext } from "../../lib/auth";
import { ORG_COOKIE, PROJECT_COOKIE } from "../../lib/context";

/**
 * Switch the active organisation or project.
 *
 * This is the only write path for context, and it validates both ids against
 * the caller's own memberships before anything is stored. A client that posts
 * an organisation id it does not belong to gets a refusal, not a cookie: the
 * switcher's list is presentation, this is the control.
 *
 * Cookies rather than a database column, deliberately: the active workspace is
 * a property of *this browser's session*, not of the user (two tabs on two
 * projects is a legitimate thing to want) and certainly not of the
 * organisation.
 */

export interface SwitchResult {
  ok: boolean;
  /** Where the caller should navigate next. Always a page they can open. */
  href: string;
  error?: string;
}

const ONE_YEAR = 60 * 60 * 24 * 365;

function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: ONE_YEAR,
  };
}

export async function switchContext(input: {
  organizationId?: string;
  projectId?: string;
}): Promise<SwitchResult> {
  const ctx = await getTenantContext();
  const jar = await cookies();

  // A project implies its organisation, so resolve it first and never accept an
  // organisation id that contradicts it.
  if (input.projectId) {
    const membership = ctx.memberships.find((m) =>
      m.projects.some((p) => p.id === input.projectId)
    );
    if (!membership) {
      return { ok: false, href: "/", error: "You don't have access to that project." };
    }
    jar.set(PROJECT_COOKIE, input.projectId, cookieOptions());
    jar.set(ORG_COOKIE, membership.organization.id, cookieOptions());
    revalidatePath("/", "layout");
    return { ok: true, href: `/?project=${encodeURIComponent(input.projectId)}` };
  }

  if (input.organizationId) {
    const membership = ctx.memberships.find((m) => m.organization.id === input.organizationId);
    if (!membership) {
      return { ok: false, href: "/", error: "You don't have access to that organisation." };
    }
    jar.set(ORG_COOKIE, membership.organization.id, cookieOptions());
    // Clear the project rather than keep a project from the previous
    // organisation: the next page must not resolve a project that belongs to
    // somewhere else.
    const first = membership.projects[0];
    if (first) jar.set(PROJECT_COOKIE, first.id, cookieOptions());
    else jar.delete(PROJECT_COOKIE);
    revalidatePath("/", "layout");
    // The overview renders an organisation-scoped empty state when there are no
    // projects yet, so it is always a valid destination.
    return { ok: true, href: first ? `/?project=${encodeURIComponent(first.id)}` : "/" };
  }

  return { ok: false, href: "/", error: "Nothing to switch to." };
}

/** Called when a remembered project or organisation no longer exists. */
export async function forgetStaleContext(): Promise<void> {
  const ctx = await getTenantContext();
  if (!ctx.active.stale) return;
  const jar = await cookies();
  // Never delete a cookie that points at something still reachable: `stale`
  // means "fell back", and deleting a valid selection would be its own bug.
  const known = new Set(ctx.memberships.flatMap((m) => m.projects.map((p) => p.id)));
  const rememberedProject = jar.get(PROJECT_COOKIE)?.value;
  if (rememberedProject && !known.has(rememberedProject)) jar.delete(PROJECT_COOKIE);
  const knownOrgs = new Set(ctx.memberships.map((m) => m.organization.id));
  const rememberedOrg = jar.get(ORG_COOKIE)?.value;
  if (rememberedOrg && !knownOrgs.has(rememberedOrg)) {
    jar.delete(ORG_COOKIE);
    jar.delete(PROJECT_COOKIE);
  }
}
