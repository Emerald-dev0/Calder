import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { eq, asc } from "drizzle-orm";
import { getSessionUser, SESSION_COOKIE, type SessionUser } from "@calder/auth";
import {
  getDb,
  organizationMembers,
  organizations,
  projects,
  type Organization,
  type Project,
} from "@calder/db";
import {
  ORG_COOKIE,
  PROJECT_COOKIE,
  selectActiveContext,
  sortMemberships,
  type ActiveContext,
} from "./context";

export interface TenantContext {
  user: SessionUser;
  memberships: Array<{
    organization: Organization;
    role: string;
    projects: Project[];
  }>;
  /**
   * The organisation and project this request is about, already validated
   * against `memberships`. Every page reads this instead of guessing from a
   * query parameter or from "whatever the database returned first".
   */
  active: ActiveContext;
}

/**
 * Server-only session + tenant loader. Every dashboard page calls this first:
 * no session → /login; memberships + projects scoped to the user, always.
 * (Middleware checks cookie presence for speed; THIS is the enforcement.)
 */
export const getTenantContext = cache(async (): Promise<TenantContext> => {
  const cookieStore = await cookies();
  const user = await getSessionUser(cookieStore.get(SESSION_COOKIE)?.value);
  if (!user) redirect("/login");

  const db = getDb();
  // Ordered on purpose: without an ORDER BY, "the first organisation" is
  // whatever the plan happens to return, so context could change between two
  // requests for the same user.
  const memberships = await db
    .select({ membership: organizationMembers, organization: organizations })
    .from(organizationMembers)
    .innerJoin(organizations, eq(organizationMembers.organizationId, organizations.id))
    .where(eq(organizationMembers.userId, user.userId))
    .orderBy(asc(organizations.createdAt), asc(organizations.id));

  const withProjects = sortMemberships(
    await Promise.all(
      memberships.map(async (m) => ({
        organization: m.organization,
        role: m.membership.role,
        projects: await db
          .select()
          .from(projects)
          .where(eq(projects.organizationId, m.organization.id))
          .orderBy(asc(projects.createdAt), asc(projects.id)),
      }))
    )
  );

  const active = selectActiveContext(withProjects, {
    // `?project=` / `?org=` are request hints, not grants: they resolve only
    // against the memberships above.
    rememberedProjectId: cookieStore.get(PROJECT_COOKIE)?.value ?? null,
    rememberedOrganizationId: cookieStore.get(ORG_COOKIE)?.value ?? null,
  });

  return { user, memberships: withProjects, active };
});

/**
 * Resolve a project against the user's own memberships.
 *
 * With no id, this returns the request's active project — the one remembered in
 * the context cookie — so navigating without a parameter keeps the user where
 * they were instead of jumping to an arbitrary project. With an id, the id is a
 * *request*: it resolves only if that project belongs to one of the caller's
 * organisations, and an unknown id returns `null` rather than falling back,
 * because a page must never silently show a different project than the one in
 * the URL.
 */
export function resolveProject(
  ctx: TenantContext,
  projectId: string | undefined
): {
  organization: Organization;
  project: Project;
  role: string;
} | null {
  if (projectId) {
    for (const m of ctx.memberships) {
      const project = m.projects.find((p) => p.id === projectId);
      if (project) return { organization: m.organization, project, role: m.role };
    }
    return null;
  }
  const { organization, project, role } = ctx.active;
  if (!organization || !project || !role) return null;
  // The active context is derived from memberships, but re-derive the typed
  // rows here so callers keep the full Organization/Project shapes.
  const membership = ctx.memberships.find((m) => m.organization.id === organization.id);
  const fullProject = membership?.projects.find((p) => p.id === project.id);
  if (!membership || !fullProject) return null;
  return { organization: membership.organization, project: fullProject, role: membership.role };
}
