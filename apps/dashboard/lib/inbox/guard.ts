import { and, eq } from "drizzle-orm";
import {
  getDb,
  inboxRolesForUser,
  inboxes,
  inboxCapabilities,
  type InboxCapability,
} from "@calder/db";
import { getTenantContext } from "../auth";

/**
 * The single gate for inbox work in the dashboard.
 *
 * Every server action and page goes through `resolveInboxAccess`, which:
 *
 *  1. reads the session (never a client-supplied user id),
 *  2. finds the caller's *organisation* membership for the inbox's project —
 *     so an inbox id from another workspace resolves to "not found",
 *  3. reads their explicit inbox membership,
 *  4. asks the shared pure capability function what that combination allows.
 *
 * Steps 3–4 are the only place inbox authorisation is decided, so a viewer
 * cannot reply by finding an action that forgot to check.
 */
export interface InboxAccess {
  userId: string;
  inboxId: string;
  projectId: string;
  organizationId: string;
  organizationRole: string;
  inboxRole: "viewer" | "member" | "manager" | null;
  capabilities: ReturnType<typeof inboxCapabilities>;
}

export class InboxAccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InboxAccessError";
  }
}

export async function resolveInboxAccess(inboxId: string): Promise<InboxAccess> {
  const ctx = await getTenantContext();
  const db = getDb();

  const [inbox] = await db.select().from(inboxes).where(eq(inboxes.id, inboxId)).limit(1);
  if (!inbox) throw new InboxAccessError("Inbox not found.");

  const membership = ctx.memberships.find((m) => m.organization.id === inbox.organizationId);
  if (!membership) {
    // Do not distinguish "exists elsewhere" from "does not exist".
    throw new InboxAccessError("Inbox not found.");
  }

  const roles = await inboxRolesForUser(db, ctx.user.userId, [inboxId]);
  const inboxRole = roles.get(inboxId) ?? null;
  const capabilities = inboxCapabilities({
    organizationRole: membership.role,
    inboxRole,
  });
  if (!capabilities.view) throw new InboxAccessError("You do not have access to this inbox.");

  return {
    userId: ctx.user.userId,
    inboxId,
    projectId: inbox.projectId,
    organizationId: inbox.organizationId,
    organizationRole: membership.role,
    inboxRole,
    capabilities,
  };
}

export async function requireInboxCapability(
  inboxId: string,
  capability: InboxCapability
): Promise<InboxAccess> {
  const access = await resolveInboxAccess(inboxId);
  if (!access.capabilities[capability]) {
    throw new InboxAccessError(
      capability === "manageMembers" || capability === "manageSettings"
        ? "Only inbox managers can change this inbox's settings."
        : "Your inbox role does not allow this action."
    );
  }
  return access;
}

/**
 * Inboxes the signed-in user may see in one project.
 *
 * Organisation owners/admins see every inbox in the workspace (they can manage
 * them); everyone else sees only the inboxes they were added to.
 */
export async function visibleInboxesForProject(projectId: string): Promise<{
  userId: string;
  organizationRole: string;
  rows: Array<{ id: string; name: string; slug: string; role: string; capabilities: string[] }>;
}> {
  const ctx = await getTenantContext();
  const db = getDb();
  const rows = await db
    .select()
    .from(inboxes)
    .where(and(eq(inboxes.projectId, projectId), eq(inboxes.status, "active")))
    .orderBy(inboxes.name);

  const membership = ctx.memberships.find(
    (m) => m.organization.id === (rows[0]?.organizationId ?? "")
  );
  const organizationRole = membership?.role ?? "";
  const roles = await inboxRolesForUser(
    db,
    ctx.user.userId,
    rows.map((r) => r.id)
  );

  const visible = rows
    .map((row) => {
      const inboxRole = roles.get(row.id) ?? null;
      const caps = inboxCapabilities({ organizationRole, inboxRole });
      return {
        id: row.id,
        name: row.name,
        slug: row.slug,
        role: inboxRole ?? (organizationRole ? `org:${organizationRole}` : "none"),
        capabilities: Object.entries(caps)
          .filter(([, allowed]) => allowed)
          .map(([name]) => name),
        canView: caps.view,
      };
    })
    .filter((row) => row.canView)
    .map(({ canView: _canView, ...rest }) => rest);

  return { userId: ctx.user.userId, organizationRole, rows: visible };
}
