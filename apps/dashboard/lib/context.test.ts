import { describe, expect, it } from "vitest";
import {
  selectActiveContext,
  sortMemberships,
  switchableOrganizations,
  type ContextMembership,
} from "./context";

/**
 * Context selection is the piece that used to be "whatever the database
 * returned first". These tests pin the rules, including the two that protect
 * data: a request for something you don't belong to is refused, and a
 * remembered selection is validated on every read.
 */

const at = (iso: string) => new Date(iso);

function membership(
  org: { id: string; name: string; createdAt: string },
  role: string,
  projects: Array<{ id: string; name: string; createdAt: string }>
): ContextMembership {
  return {
    organization: {
      id: org.id,
      name: org.name,
      slug: org.id,
      createdAt: at(org.createdAt),
    },
    role,
    projects: projects.map((p) => ({
      id: p.id,
      name: p.name,
      slug: p.id,
      organizationId: org.id,
      createdAt: at(p.createdAt),
    })),
  };
}

const alpha = membership(
  { id: "org_alpha", name: "Alpha", createdAt: "2026-01-01T00:00:00Z" },
  "owner",
  [
    { id: "proj_a1", name: "A1", createdAt: "2026-01-02T00:00:00Z" },
    { id: "proj_a2", name: "A2", createdAt: "2026-01-03T00:00:00Z" },
  ]
);
const beta = membership(
  { id: "org_beta", name: "Beta", createdAt: "2026-02-01T00:00:00Z" },
  "admin",
  [{ id: "proj_b1", name: "B1", createdAt: "2026-02-02T00:00:00Z" }]
);
const emptyOrg = membership(
  { id: "org_empty", name: "Empty", createdAt: "2026-03-01T00:00:00Z" },
  "member",
  []
);

const all = [beta, alpha, emptyOrg]; // deliberately not in creation order

describe("selectActiveContext", () => {
  it("is deterministic regardless of the order the query returned", () => {
    const forward = selectActiveContext([alpha, beta, emptyOrg]);
    const reversed = selectActiveContext([emptyOrg, beta, alpha]);
    expect(forward.organization?.id).toBe("org_alpha");
    expect(reversed.organization?.id).toBe("org_alpha");
    expect(forward.project?.id).toBe("proj_a1");
    expect(reversed.project?.id).toBe("proj_a1");
    expect(forward.source).toBe("first");
  });

  it("prefers an explicitly requested project and takes its organisation with it", () => {
    const ctx = selectActiveContext(all, { requestedProjectId: "proj_b1" });
    expect(ctx.organization?.id).toBe("org_beta");
    expect(ctx.project?.id).toBe("proj_b1");
    expect(ctx.source).toBe("requested");
  });

  it("refuses a requested project the user does not belong to", () => {
    const ctx = selectActiveContext(all, { requestedProjectId: "proj_someone_else" });
    // Falls back to their own first organisation, never to the stranger's.
    expect(ctx.organization?.id).toBe("org_alpha");
    expect(ctx.project?.id).toBe("proj_a1");
    expect(ctx.source).toBe("first");
  });

  it("honours a requested organisation, including one with no projects", () => {
    const withProjects = selectActiveContext(all, { requestedOrganizationId: "org_beta" });
    expect(withProjects.organization?.id).toBe("org_beta");
    expect(withProjects.project?.id).toBe("proj_b1");

    const empty = selectActiveContext(all, { requestedOrganizationId: "org_empty" });
    expect(empty.organization?.id).toBe("org_empty");
    expect(empty.project).toBeNull();
  });

  it("refuses a requested organisation the user does not belong to", () => {
    const ctx = selectActiveContext(all, { requestedOrganizationId: "org_stranger" });
    expect(ctx.organization?.id).toBe("org_alpha");
    expect(ctx.source).toBe("first");
  });

  it("remembers a project across requests", () => {
    const ctx = selectActiveContext(all, { rememberedProjectId: "proj_a2" });
    expect(ctx.project?.id).toBe("proj_a2");
    expect(ctx.organization?.id).toBe("org_alpha");
    expect(ctx.source).toBe("remembered");
    expect(ctx.stale).toBe(false);
  });

  it("remembers an organisation that holds no projects", () => {
    const ctx = selectActiveContext(all, { rememberedOrganizationId: "org_empty" });
    expect(ctx.organization?.id).toBe("org_empty");
    expect(ctx.project).toBeNull();
    expect(ctx.stale).toBe(false);
  });

  it("flags a remembered project that was deleted and falls back", () => {
    const ctx = selectActiveContext(all, { rememberedProjectId: "proj_deleted" });
    expect(ctx.organization?.id).toBe("org_alpha");
    expect(ctx.project?.id).toBe("proj_a1");
    expect(ctx.stale).toBe(true);
  });

  it("flags a remembered organisation the user was removed from", () => {
    const ctx = selectActiveContext(all, { rememberedOrganizationId: "org_removed" });
    expect(ctx.organization?.id).toBe("org_alpha");
    expect(ctx.stale).toBe(true);
  });

  it("keeps the organisation when only the remembered project is gone", () => {
    const ctx = selectActiveContext(all, {
      rememberedOrganizationId: "org_beta",
      rememberedProjectId: "proj_deleted",
    });
    expect(ctx.organization?.id).toBe("org_beta");
    expect(ctx.project?.id).toBe("proj_b1");
    // A project was substituted, so the caller must know it is not what was asked.
    expect(ctx.stale).toBe(true);
  });

  it("reports no context when the user has no memberships", () => {
    const ctx = selectActiveContext([], { rememberedProjectId: "proj_a1" });
    expect(ctx.organization).toBeNull();
    expect(ctx.project).toBeNull();
    expect(ctx.source).toBe("none");
    expect(ctx.stale).toBe(true);
  });

  it("never mixes an organisation with a project from another one", () => {
    // The cookie pair is inconsistent (org Beta remembered, project from
    // Alpha). A remembered project is the more specific statement, so it wins
    // and drags its own organisation along; the explicit `?org=` request is the
    // one thing that outranks it (next assertion). What must never happen is a
    // page rendering Beta's chrome around Alpha's project.
    const ctx = selectActiveContext(all, {
      rememberedOrganizationId: "org_beta",
      rememberedProjectId: "proj_a1",
    });
    expect(ctx.organization?.id).toBe("org_alpha");
    expect(ctx.project?.id).toBe("proj_a1");

    const explicit = selectActiveContext(all, {
      requestedOrganizationId: "org_beta",
      rememberedProjectId: "proj_a1",
    });
    expect(explicit.organization?.id).toBe("org_beta");
    expect(explicit.project?.id).toBe("proj_b1");
  });
});

describe("sortMemberships", () => {
  it("orders organisations and their projects oldest first, stably", () => {
    const sorted = sortMemberships(all);
    expect(sorted.map((m) => m.organization.id)).toEqual(["org_alpha", "org_beta", "org_empty"]);
    expect(sorted[0]!.projects.map((p) => p.id)).toEqual(["proj_a1", "proj_a2"]);
  });

  it("does not mutate its input", () => {
    const input = [beta, alpha];
    sortMemberships(input);
    expect(input[0]!.organization.id).toBe("org_beta");
  });
});

describe("switchableOrganizations", () => {
  it("lists every organisation with its role, including empty ones", () => {
    const list = switchableOrganizations(all);
    expect(list.map((o) => o.name)).toEqual(["Alpha", "Beta", "Empty"]);
    expect(list.find((o) => o.id === "org_empty")?.projects).toEqual([]);
    expect(list.find((o) => o.id === "org_beta")?.role).toBe("admin");
  });
});
