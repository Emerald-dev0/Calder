import "../server-only";

import { and, count, eq, isNull } from "drizzle-orm";
import {
  apiKeys,
  auditLogs,
  broadcasts,
  checkOrganizationResource,
  domains,
  emails,
  getDb,
  organizationMembers,
  organizations,
  projects,
  senderIdentities,
  suppressions,
  webhooks,
  type DbClient,
} from "@calder/db";
import { randomUUID } from "node:crypto";

/**
 * Moving a project between organisations.
 *
 * The schema makes this mostly an update of one column — every project resource
 * (`domains`, `sender_identities`, `api_keys`, `webhooks`, `emails`,
 * `templates`) hangs off `project_id`, so it follows the project by definition
 * and nothing is duplicated or recreated.
 *
 * What does **not** follow, and is therefore the whole job:
 *
 *  - `suppressions` carry a denormalised `organization_id` maintained by a
 *    trigger that only fires on `UPDATE OF project_id`. Moving the project rows
 *    leaves those rows pointing at the old workspace, which is a cross-tenant
 *    read: the destination org would see the project's bounces under the
 *    source's id and the source would keep enforcing them. They are rewritten
 *    inside the same transaction.
 *  - `usage_records` are org-scoped history. They stay with the organisation
 *    that was billed, because a transfer is not a refund. The consequence —
 *    the destination inherits the project with a clean usage period — is
 *    stated in the confirmation rather than hidden.
 *  - `audit_logs` are per-organisation. A transfer writes one row in each, so
 *    both sides can answer "where did this go" without reading the other's log.
 *
 * Everything runs in one transaction with the project row locked, so a transfer
 * cannot half-apply, and the limit checks are re-run inside the transaction
 * because a concurrent creation could have filled the destination while the
 * user was reading the confirmation screen.
 */

export class TransferError extends Error {
  readonly code:
    | "forbidden"
    | "not_found"
    | "same_organization"
    | "destination_limit"
    | "blocked"
    | "confirmation_mismatch";

  constructor(code: TransferError["code"], message: string) {
    super(message);
    this.name = "TransferError";
    this.code = code;
  }
}

export interface TransferInventory {
  domains: number;
  verifiedDomains: number;
  senders: number;
  apiKeys: number;
  webhooks: number;
  emails: number;
  suppressions: number;
  broadcasts: number;
}

export interface TransferPreview {
  project: { id: string; name: string; slug: string };
  source: { id: string; name: string; members: number };
  destination: { id: string; name: string; members: number };
  inventory: TransferInventory;
  /** What moves without any row being touched. */
  movesAutomatically: string[];
  /** Rows this transaction rewrites. */
  rewritten: string[];
  /** Things that deliberately do not move. */
  staysBehind: string[];
  destinationProjects: { used: number; limit: number | null };
  destinationDomains: { used: number; limit: number | null };
  slugConflict: boolean;
  resolvedSlug: string;
  blockers: string[];
  warnings: string[];
}

const PROJECT_ROLE_CAN_MOVE = new Set(["owner", "admin"]);

async function membersOf(db: DbClient | DbExecutorLike, organizationId: string): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(organizationMembers)
    .where(eq(organizationMembers.organizationId, organizationId));
  return Number(row?.value ?? 0);
}

// The subset of the drizzle client used by the helpers below (a transaction
// handle is not a `DbClient`).
type DbExecutorLike = {
  select: DbClient["select"];
};

export async function projectInventory(
  db: DbClient | DbExecutorLike,
  projectId: string
): Promise<TransferInventory> {
  const [domainRows, senderRow, keyRow, webhookRow, emailRow, suppressionRow, broadcastRow] =
    await Promise.all([
      db.select({ status: domains.status }).from(domains).where(eq(domains.projectId, projectId)),
      db
        .select({ value: count() })
        .from(senderIdentities)
        .where(and(eq(senderIdentities.projectId, projectId), isNull(senderIdentities.archivedAt))),
      db
        .select({ value: count() })
        .from(apiKeys)
        .where(and(eq(apiKeys.projectId, projectId), isNull(apiKeys.revokedAt))),
      db.select({ value: count() }).from(webhooks).where(eq(webhooks.projectId, projectId)),
      db.select({ value: count() }).from(emails).where(eq(emails.projectId, projectId)),
      db.select({ value: count() }).from(suppressions).where(eq(suppressions.projectId, projectId)),
      db.select({ value: count() }).from(broadcasts).where(eq(broadcasts.projectId, projectId)),
    ]);

  return {
    domains: domainRows.length,
    verifiedDomains: domainRows.filter((d) => d.status === "verified").length,
    senders: Number(senderRow[0]?.value ?? 0),
    apiKeys: Number(keyRow[0]?.value ?? 0),
    webhooks: Number(webhookRow[0]?.value ?? 0),
    emails: Number(emailRow[0]?.value ?? 0),
    suppressions: Number(suppressionRow[0]?.value ?? 0),
    broadcasts: Number(broadcastRow[0]?.value ?? 0),
  };
}

/** `slug`, or `slug-2`, `slug-3`… — the destination may already use it. */
async function resolveSlug(
  db: DbClient | DbExecutorLike,
  organizationId: string,
  desired: string
): Promise<{ slug: string; conflict: boolean }> {
  const rows = await db
    .select({ slug: projects.slug })
    .from(projects)
    .where(eq(projects.organizationId, organizationId));
  const taken = new Set(rows.map((r) => r.slug));
  if (!taken.has(desired)) return { slug: desired, conflict: false };
  for (let i = 2; i < 50; i++) {
    const candidate = `${desired}-${i}`;
    if (!taken.has(candidate)) return { slug: candidate, conflict: true };
  }
  return { slug: `${desired}-${randomUUID().slice(0, 6)}`, conflict: true };
}

export interface PreviewInput {
  viewerUserId: string;
  memberships: Array<{ organizationId: string; role: string }>;
  projectId: string;
  destinationOrganizationId: string;
}

/**
 * Everything the confirmation screen needs, computed from the same helpers the
 * transfer itself uses — so the preview cannot promise something the transfer
 * then refuses, or hide a consequence it will actually apply.
 */
export async function previewProjectTransfer(input: PreviewInput): Promise<TransferPreview> {
  const db = getDb();

  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, input.projectId))
    .limit(1);
  if (!project) throw new TransferError("not_found", "Project not found.");

  const sourceRole = input.memberships.find(
    (m) => m.organizationId === project.organizationId
  )?.role;
  if (!sourceRole || !PROJECT_ROLE_CAN_MOVE.has(sourceRole)) {
    throw new TransferError(
      "forbidden",
      "Only an owner or admin of the project's current organisation can move it."
    );
  }

  if (input.destinationOrganizationId === project.organizationId) {
    throw new TransferError("same_organization", "The project is already in that organisation.");
  }

  const destinationRole = input.memberships.find(
    (m) => m.organizationId === input.destinationOrganizationId
  )?.role;
  if (!destinationRole || !PROJECT_ROLE_CAN_MOVE.has(destinationRole)) {
    throw new TransferError(
      "forbidden",
      "You need owner or admin rights in the destination organisation to receive a project."
    );
  }

  const [sourceOrg] = await db
    .select({ id: organizations.id, name: organizations.name })
    .from(organizations)
    .where(eq(organizations.id, project.organizationId))
    .limit(1);
  const [destinationOrg] = await db
    .select({
      id: organizations.id,
      name: organizations.name,
      sendingStatus: organizations.sendingStatus,
    })
    .from(organizations)
    .where(eq(organizations.id, input.destinationOrganizationId))
    .limit(1);
  if (!sourceOrg || !destinationOrg)
    throw new TransferError("not_found", "Organisation not found.");

  const [inventory, sourceMembers, destinationMembers, projectUsage, domainUsage, slug] =
    await Promise.all([
      projectInventory(db, project.id),
      membersOf(db, sourceOrg.id),
      membersOf(db, destinationOrg.id),
      checkOrganizationResource(db, destinationOrg.id, "projects"),
      checkOrganizationResource(db, destinationOrg.id, "domains"),
      resolveSlug(db, destinationOrg.id, project.slug),
    ]);

  const blockers: string[] = [];
  const warnings: string[] = [];

  if (inventory.broadcasts > 0) {
    blockers.push(
      `This project has ${inventory.broadcasts} broadcast${
        inventory.broadcasts === 1 ? "" : "s"
      }. Broadcasts send from the organisation's audiences and contacts, which stay behind — moving the project would leave them pointing across organisations. Marketing is not part of this release, so a project with broadcasts cannot be moved yet.`
    );
  }

  if (!projectUsage.allowed) {
    blockers.push(
      `${destinationOrg.name} is at its project limit (${projectUsage.used} of ${
        projectUsage.limit ?? "∞"
      } on ${projectUsage.displayName}). Nothing was changed — free a slot there or move to a larger plan first.`
    );
  }

  const roomForDomains =
    domainUsage.limit === null ? Infinity : domainUsage.limit - domainUsage.used;
  if (inventory.domains > roomForDomains) {
    blockers.push(
      `${destinationOrg.name} has room for ${Math.max(roomForDomains, 0)} more domain${
        roomForDomains === 1 ? "" : "s"
      } on ${domainUsage.displayName}, and this project carries ${inventory.domains}. Domains are sold per organisation, so they move with the project and must fit.`
    );
  }

  if (destinationOrg.sendingStatus !== "active") {
    warnings.push(
      `${destinationOrg.name} is currently ${destinationOrg.sendingStatus.replace("_", " ")}. Mail from this project will be refused there until it is resumed.`
    );
  }

  warnings.push(
    `${destinationMembers} member${destinationMembers === 1 ? "" : "s"} of ${
      destinationOrg.name
    } will be able to see and manage this project, its API keys, its domains and its delivery history. ${sourceMembers} member${
      sourceMembers === 1 ? "" : "s"
    } of ${sourceOrg.name} — including you, unless you also belong there — will lose access immediately.`
  );

  if (inventory.apiKeys > 0) {
    warnings.push(
      `${inventory.apiKeys} live API key${inventory.apiKeys === 1 ? "" : "s"} keep working: keys belong to the project, so no rotation and no downtime. The flip side is that those keys are now governed by ${destinationOrg.name}'s plan, limits and admins.`
    );
  }

  if (inventory.verifiedDomains > 0) {
    warnings.push(
      `${inventory.verifiedDomains} verified domain${
        inventory.verifiedDomains === 1 ? "" : "s"
      } move with the project and keep their DNS records; no re-verification is needed. The same domain cannot be verified in two organisations at once, which is why the source org stops counting it.`
    );
  }

  warnings.push(
    "Usage history stays with the organisation that was billed for it. Past sends are not re-charged to the destination, and the destination's monthly allowance is unaffected by what this project already sent."
  );

  return {
    project: { id: project.id, name: project.name, slug: project.slug },
    source: { id: sourceOrg.id, name: sourceOrg.name, members: sourceMembers },
    destination: { id: destinationOrg.id, name: destinationOrg.name, members: destinationMembers },
    inventory,
    movesAutomatically: [
      "domains and their DNS challenges",
      "sender identities and transports",
      "API keys and their sender grants",
      "webhooks and their delivery history",
      "templates",
      "delivery history (emails and events)",
    ],
    rewritten: [
      `${inventory.suppressions} suppression record${
        inventory.suppressions === 1 ? "" : "s"
      } re-pointed at ${destinationOrg.name}`,
      "one audit entry in each organisation",
      slug.conflict
        ? `the project slug becomes "${slug.slug}" (taken in the destination)`
        : "the project slug (unchanged)",
    ],
    staysBehind: [
      "organisation audiences and contacts",
      "billing, credits and invoices",
      "usage history",
      "team memberships",
    ],
    destinationProjects: { used: projectUsage.used, limit: projectUsage.limit },
    destinationDomains: { used: domainUsage.used, limit: domainUsage.limit },
    slugConflict: slug.conflict,
    resolvedSlug: slug.slug,
    blockers,
    warnings,
  };
}

export interface TransferInput {
  viewerUserId: string;
  memberships: Array<{ organizationId: string; role: string }>;
  projectId: string;
  destinationOrganizationId: string;
  /** The caller types the project name; a mis-click cannot move a project. */
  confirmation: string;
}

/**
 * Apply the transfer. Atomic: the project row is locked, every check is re-run
 * inside the transaction, and any refusal rolls back to the exact state before
 * the call.
 */
export async function transferProject(input: TransferInput): Promise<{
  projectId: string;
  fromOrganizationId: string;
  toOrganizationId: string;
  slug: string;
}> {
  const db = getDb();

  return db.transaction(async (tx) => {
    const [project] = await tx
      .select()
      .from(projects)
      .where(eq(projects.id, input.projectId))
      .for("update")
      .limit(1);
    if (!project) throw new TransferError("not_found", "Project not found.");

    if (project.name.trim().toLowerCase() !== input.confirmation.trim().toLowerCase()) {
      throw new TransferError(
        "confirmation_mismatch",
        `Type the project name exactly ("${project.name}") to confirm. Nothing was changed.`
      );
    }

    const sourceRole = input.memberships.find(
      (m) => m.organizationId === project.organizationId
    )?.role;
    if (!sourceRole || !PROJECT_ROLE_CAN_MOVE.has(sourceRole)) {
      throw new TransferError("forbidden", "You cannot move this project.");
    }
    const destinationRole = input.memberships.find(
      (m) => m.organizationId === input.destinationOrganizationId
    )?.role;
    if (!destinationRole || !PROJECT_ROLE_CAN_MOVE.has(destinationRole)) {
      throw new TransferError("forbidden", "You cannot move a project into that organisation.");
    }
    if (project.organizationId === input.destinationOrganizationId) {
      throw new TransferError("same_organization", "The project is already in that organisation.");
    }

    // Re-checked here, not just on the preview screen: between reading the
    // confirmation and pressing the button, another tab could have filled the
    // destination's plan.
    const [projectUsage, domainUsage] = await Promise.all([
      checkOrganizationResource(
        tx as unknown as DbClient,
        input.destinationOrganizationId,
        "projects"
      ),
      checkOrganizationResource(
        tx as unknown as DbClient,
        input.destinationOrganizationId,
        "domains"
      ),
    ]);
    if (!projectUsage.allowed) {
      throw new TransferError(
        "destination_limit",
        projectUsage.message ?? "Destination plan limit reached."
      );
    }
    const roomForDomains =
      domainUsage.limit === null ? Infinity : domainUsage.limit - domainUsage.used;
    const [domainRow] = await tx
      .select({ value: count() })
      .from(domains)
      .where(eq(domains.projectId, project.id));
    const projectDomains = Number(domainRow?.value ?? 0);
    if (projectDomains > roomForDomains) {
      throw new TransferError(
        "destination_limit",
        `The destination has room for ${Math.max(roomForDomains, 0)} more domain${
          roomForDomains === 1 ? "" : "s"
        } and this project carries ${projectDomains}.`
      );
    }

    const [broadcastRow] = await tx
      .select({ value: count() })
      .from(broadcasts)
      .where(eq(broadcasts.projectId, project.id));
    if (Number(broadcastRow?.value ?? 0) > 0) {
      throw new TransferError(
        "blocked",
        "This project has broadcasts, which depend on its organisation's audiences. It cannot be moved yet."
      );
    }

    const slug = await resolveSlug(
      tx as unknown as DbExecutorLike,
      input.destinationOrganizationId,
      project.slug
    );

    await tx
      .update(projects)
      .set({
        organizationId: input.destinationOrganizationId,
        slug: slug.slug,
        updatedAt: new Date(),
      })
      .where(eq(projects.id, project.id));

    // The one row set the schema will not maintain for us. The trigger on
    // `suppressions` fires only on `UPDATE OF project_id`, which this transfer
    // does not touch.
    const moved = await tx
      .update(suppressions)
      .set({ organizationId: input.destinationOrganizationId })
      .where(
        and(
          eq(suppressions.projectId, project.id),
          eq(suppressions.organizationId, project.organizationId)
        )
      )
      .returning({ id: suppressions.id });

    const metadata = {
      projectId: project.id,
      projectName: project.name,
      fromOrganizationId: project.organizationId,
      toOrganizationId: input.destinationOrganizationId,
      previousSlug: project.slug,
      newSlug: slug.slug,
      suppressionsMoved: moved.length,
      actorUserId: input.viewerUserId,
    };
    await tx.insert(auditLogs).values([
      {
        id: `audit_${randomUUID().replace(/-/g, "")}`,
        organizationId: project.organizationId,
        projectId: project.id,
        actorUserId: input.viewerUserId,
        action: "project.transferred_out",
        targetType: "project",
        targetId: project.id,
        metadata,
      },
      {
        id: `audit_${randomUUID().replace(/-/g, "")}`,
        organizationId: input.destinationOrganizationId,
        projectId: project.id,
        actorUserId: input.viewerUserId,
        action: "project.transferred_in",
        targetType: "project",
        targetId: project.id,
        metadata,
      },
    ]);

    return {
      projectId: project.id,
      fromOrganizationId: project.organizationId,
      toOrganizationId: input.destinationOrganizationId,
      slug: slug.slug,
    };
  });
}

/** Guard used by the pages: how many projects the org holds, for the list header. */
export async function organizationProjectCount(organizationId: string): Promise<number> {
  const [row] = await getDb()
    .select({ value: count() })
    .from(projects)
    .where(eq(projects.organizationId, organizationId));
  return Number(row?.value ?? 0);
}
