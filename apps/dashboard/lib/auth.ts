import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { eq } from "drizzle-orm";
import { getSessionUser, SESSION_COOKIE, type SessionUser } from "@avenor/auth";
import {
  getDb,
  organizationMembers,
  organizations,
  projects,
  type Organization,
  type Project,
} from "@avenor/db";

export interface TenantContext {
  user: SessionUser;
  memberships: Array<{
    organization: Organization;
    role: string;
    projects: Project[];
  }>;
}

/**
 * Server-only session + tenant loader. Every dashboard page calls this first:
 * no session → /login; memberships + projects scoped to the user, always.
 * (Middleware checks cookie presence for speed; THIS is the enforcement.)
 */
export const getTenantContext = cache(async (): Promise<TenantContext> => {
  const cookieStore = cookies();
  const user = await getSessionUser(cookieStore.get(SESSION_COOKIE)?.value);
  if (!user) redirect("/login");

  const db = getDb();
  const memberships = await db
    .select({ membership: organizationMembers, organization: organizations })
    .from(organizationMembers)
    .innerJoin(organizations, eq(organizationMembers.organizationId, organizations.id))
    .where(eq(organizationMembers.userId, user.userId));

  const withProjects = await Promise.all(
    memberships.map(async (m) => ({
      organization: m.organization,
      role: m.membership.role,
      projects: await db
        .select()
        .from(projects)
        .where(eq(projects.organizationId, m.organization.id)),
    }))
  );

  return { user, memberships: withProjects };
});

/** Resolve ?project= against the user's own projects; default to the first. */
export function resolveProject(
  ctx: TenantContext,
  projectId: string | undefined
): {
  organization: Organization;
  project: Project;
  role: string;
} | null {
  const all: Array<{ organization: Organization; project: Project; role: string }> = [];
  for (const m of ctx.memberships) {
    for (const p of m.projects)
      all.push({ organization: m.organization, project: p, role: m.role });
  }
  if (projectId) return all.find((a) => a.project.id === projectId) ?? null;
  return all[0] ?? null;
}
