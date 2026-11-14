import "./server-only";

/**
 * The active organisation and project.
 *
 * Before this file, "which organisation am I in" was inferred from a `?project=`
 * query parameter on every request and otherwise from `memberships[0]` — an
 * unordered query. Context could therefore change on navigation, disagree
 * between two tabs, or differ between the settings page (which had its own
 * `?org=` parameter) and the page you came from. This module makes the context
 * a single, server-validated fact:
 *
 *   requested project  →  requested org  →  remembered project  →  remembered org  →  first org
 *
 * Every step is filtered through the caller's own memberships, so a cookie or a
 * query parameter is only ever a *hint about which of my own things to show* —
 * never a grant. A hint that no longer resolves (the organisation removed me,
 * the project was deleted) is ignored and reported as stale so the caller can
 * clear it, rather than silently showing a different project forever.
 */

export const ORG_COOKIE = "calder_org";
export const PROJECT_COOKIE = "calder_project";

export interface ContextOrganization {
  id: string;
  name: string;
  slug: string;
  createdAt: Date;
}

export interface ContextProject {
  id: string;
  name: string;
  slug: string;
  organizationId: string;
  createdAt: Date;
}

export interface ContextMembership {
  organization: ContextOrganization;
  role: string;
  projects: ContextProject[];
}

export type ContextSource = "requested" | "remembered" | "first" | "none";

export interface ActiveContext {
  organization: ContextOrganization | null;
  project: ContextProject | null;
  role: string | null;
  /** Where the selection came from — shown in the UI, asserted in tests. */
  source: ContextSource;
  /**
   * True when a *remembered* id (a cookie) no longer resolves — the user was
   * removed from the organisation, or the project was deleted. The caller
   * clears the cookie. Requested ids are not "stale": a `?project=` that does'
   * not resolve is refused at the page level (`resolveProject` returns null),
   * because a URL is a request and never a stored preference.
   */
  stale: boolean;
}

/** Stable ordering, so "the first org" is the same org on every request. */
function byCreatedThenId<T extends { createdAt: Date; id: string }>(a: T, b: T): number {
  const delta = a.createdAt.getTime() - b.createdAt.getTime();
  return delta !== 0 ? delta : a.id.localeCompare(b.id);
}

/**
 * Generic on purpose: the loader passes full `Organization` rows, the UI passes
 * the trimmed shell shape, and both must sort identically.
 */
export function sortMemberships<T extends ContextMembership>(memberships: T[]): T[] {
  return [...memberships]
    .sort((a, b) => byCreatedThenId(a.organization, b.organization))
    .map((m) => ({ ...m, projects: [...m.projects].sort(byCreatedThenId) }));
}

export interface ContextHints {
  /** `?project=` */
  requestedProjectId?: string | null;
  /** `?org=` */
  requestedOrganizationId?: string | null;
  /** `calder_project` cookie */
  rememberedProjectId?: string | null;
  /** `calder_org` cookie */
  rememberedOrganizationId?: string | null;
}

/**
 * Pure selection. No database, no cookies: everything comes in as validated
 * membership data, which is what makes the precedence rules testable without a
 * request.
 */
export function selectActiveContext(
  memberships: ContextMembership[],
  hints: ContextHints = {}
): ActiveContext {
  const ordered = sortMemberships(memberships);
  const rememberedBothGone = Boolean(hints.rememberedProjectId || hints.rememberedOrganizationId);
  if (ordered.length === 0) {
    return {
      organization: null,
      project: null,
      role: null,
      source: "none",
      stale: rememberedBothGone,
    };
  }

  const findByProject = (projectId: string) => {
    for (const m of ordered) {
      const project = m.projects.find((p) => p.id === projectId);
      if (project) return { membership: m, project };
    }
    return null;
  };

  const requestedOrgId = hints.requestedOrganizationId || null;
  const rememberedOrgId = hints.rememberedOrganizationId || null;

  // 1. An explicit project wins: it identifies the organisation too, so the two
  //    can never disagree.
  if (hints.requestedProjectId) {
    const hit = findByProject(hints.requestedProjectId);
    if (hit) {
      return {
        organization: hit.membership.organization,
        project: hit.project,
        role: hit.membership.role,
        source: "requested",
        stale: false,
      };
    }
  }

  // 2. An explicit organisation. Its project is the remembered one when that
  //    project lives here, otherwise the organisation's first project — and
  //    null when the organisation has no projects, which is a legitimate state.
  const explicitOrg = requestedOrgId
    ? (ordered.find((m) => m.organization.id === requestedOrgId) ?? null)
    : null;
  if (explicitOrg) {
    const remembered = hints.rememberedProjectId
      ? explicitOrg.projects.find((p) => p.id === hints.rememberedProjectId)
      : undefined;
    const project = remembered ?? explicitOrg.projects[0] ?? null;
    return {
      organization: explicitOrg.organization,
      project,
      role: explicitOrg.role,
      source: "requested",
      stale: false,
    };
  }

  // 3. What the user last chose.
  if (hints.rememberedProjectId) {
    const hit = findByProject(hints.rememberedProjectId);
    if (hit) {
      return {
        organization: hit.membership.organization,
        project: hit.project,
        role: hit.membership.role,
        source: "remembered",
        stale: false,
      };
    }
  }
  if (rememberedOrgId) {
    const rememberedOrg = ordered.find((m) => m.organization.id === rememberedOrgId);
    if (rememberedOrg) {
      return {
        organization: rememberedOrg.organization,
        project: rememberedOrg.projects[0] ?? null,
        role: rememberedOrg.role,
        source: "remembered",
        // The remembered *project* is gone but the organisation is still mine:
        // we did substitute a project, so say so rather than pretend.
        stale: Boolean(hints.rememberedProjectId),
      };
    }
  }

  // 4. Nothing chosen, or nothing chosen still exists.
  const first = ordered[0]!;
  return {
    organization: first.organization,
    project: first.projects[0] ?? null,
    role: first.role,
    source: "first",
    // Reaching here with a remembered id set means neither resolved.
    stale: rememberedBothGone,
  };
}

/** The organisations this user may switch to, with the role held in each. */
export function switchableOrganizations(memberships: ContextMembership[]) {
  return sortMemberships(memberships).map((m) => ({
    id: m.organization.id,
    name: m.organization.name,
    slug: m.organization.slug,
    role: m.role,
    projects: m.projects.map((p) => ({ id: p.id, name: p.name, slug: p.slug })),
  }));
}
