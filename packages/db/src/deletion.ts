/**
 * Deleting a workspace, a project or an account — requested, cancellable, then
 * purged by the sweep.
 *
 * There was an export (`requestDataExport`) and no delete anywhere, so the
 * question "remove my workspace and everything in it" had no answer in the
 * product. Deleting on the spot is the wrong answer too: a mistyped slug at
 * 2am, a shared screen, a form replayed twice. So a request schedules a purge
 * seven days out, and until then:
 *
 *  - **Sending stops immediately**, at ingest *and* at delivery, because a
 *    workspace on its way out must not keep spending reputation;
 *  - **the owners can cancel**, and cancelling restores the previous state
 *    exactly — that is why deletion is a separate pair of columns and not a
 *    new `sending_status` value, which would make "cancelled" and "resumed
 *    after an abuse pause" the same transition;
 *  - **nothing is deleted early**, and the purge itself is the only thing that
 *    destroys rows.
 *
 * Confirmation is typed, and checked here rather than in the form: the caller
 * passes what the person typed, this module compares it to the target's own
 * slug (or, for an account, its email address). A route that forgets to check
 * therefore cannot delete anything.
 *
 * API keys cannot reach any of this. There is no `/v1` endpoint for deletion on
 * purpose: a leaked key must not be able to erase the workspace whose mail it
 * was sending, and the owner of a key is a project, not a person.
 *
 * Purges are bounded, idempotent and audited. The audit row is written in the
 * same transaction, immediately before the delete, and the target's identity is
 * duplicated into `metadata` (id, slug, name). `audit_logs` has no foreign key
 * to the thing it describes in a deployed database, and the schema's
 * `ON DELETE SET NULL` is only a hint if one is ever added — either way the
 * slug in metadata keeps the row readable after the workspace is gone, which is
 * the point of an audit trail for deletion.
 */
import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNotNull, lte, sql } from "drizzle-orm";
import type { DbClient, DbExecutor } from "./client.js";
import { auditLogs } from "./schema/system.js";
import { organizations, organizationMembers } from "./schema/organizations.js";
import { projects } from "./schema/projects.js";
import { users } from "./schema/users.js";

/** Days between a confirmed request and the irreversible purge. */
export const DELETION_GRACE_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

const DEFAULT_MAX_PER_RUN = 25;

export type DeletionErrorCode =
  | "not_found"
  | "forbidden"
  | "confirmation_mismatch"
  | "not_scheduled"
  | "organization_pending_deletion"
  | "sole_owner";

export class DeletionError extends Error {
  readonly statusCode: number;
  /** Organisations that block an account deletion, when that is the reason. */
  readonly blockingOrganizations: Array<{ id: string; name: string }>;

  constructor(
    readonly code: DeletionErrorCode,
    message: string,
    options: {
      statusCode?: number;
      blockingOrganizations?: Array<{ id: string; name: string }>;
    } = {}
  ) {
    super(message);
    this.name = "DeletionError";
    this.statusCode =
      options.statusCode ??
      (code === "not_found" ? 404 : code === "forbidden" ? 403 : code === "sole_owner" ? 409 : 400);
    this.blockingOrganizations = options.blockingOrganizations ?? [];
  }
}

export interface DeletionSchedule {
  requestedAt: Date;
  scheduledFor: Date;
}

export interface DeletionStatus {
  pending: boolean;
  requestedAt: Date | null;
  scheduledFor: Date | null;
  /** Days left before the purge; 0 when due or overdue. */
  daysRemaining: number | null;
}

export function deletionStatusFrom(
  row: {
    deletionRequestedAt: Date | null;
    deletionScheduledFor: Date | null;
  },
  now: Date = new Date()
): DeletionStatus {
  if (!row.deletionScheduledFor) {
    return { pending: false, requestedAt: null, scheduledFor: null, daysRemaining: null };
  }
  const remaining = row.deletionScheduledFor.getTime() - now.getTime();
  return {
    pending: true,
    requestedAt: row.deletionRequestedAt,
    scheduledFor: row.deletionScheduledFor,
    daysRemaining: Math.max(0, Math.ceil(remaining / DAY_MS)),
  };
}

function auditId(): string {
  return `audit_${randomUUID().replace(/-/g, "").slice(0, 24)}`;
}

function scheduleFrom(now: Date): DeletionSchedule {
  return {
    requestedAt: now,
    scheduledFor: new Date(now.getTime() + DELETION_GRACE_DAYS * DAY_MS),
  };
}

/** Owner-or-admin of this organisation, or a thrown refusal. */
async function requireOrganizationAdmin(
  db: DbExecutor,
  organizationId: string,
  actorUserId: string,
  minimum: "owner" | "admin"
): Promise<void> {
  const [membership] = await db
    .select({ role: organizationMembers.role })
    .from(organizationMembers)
    .where(
      and(
        eq(organizationMembers.organizationId, organizationId),
        eq(organizationMembers.userId, actorUserId)
      )
    )
    .limit(1);
  if (!membership) {
    throw new DeletionError("forbidden", "You are not a member of this workspace.");
  }
  const allowed =
    minimum === "owner"
      ? membership.role === "owner"
      : membership.role === "owner" || membership.role === "admin";
  if (!allowed) {
    throw new DeletionError(
      "forbidden",
      minimum === "owner"
        ? "Only an owner can delete a workspace."
        : "Only an owner or admin can delete a project."
    );
  }
}

export interface OrganizationDeletionRequest {
  alreadyRequested: boolean;
  scheduledFor: Date;
}

/**
 * Schedule a workspace for deletion. The typed confirmation must be the
 * workspace slug — the caller passes what the person typed, never a boolean.
 */
export async function requestOrganizationDeletion(
  db: DbClient,
  input: {
    organizationId: string;
    actorUserId: string;
    confirmation: string;
    now?: Date;
  }
): Promise<OrganizationDeletionRequest> {
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    const [organization] = await tx
      .select({
        id: organizations.id,
        slug: organizations.slug,
        name: organizations.name,
        deletionRequestedAt: organizations.deletionRequestedAt,
        deletionScheduledFor: organizations.deletionScheduledFor,
      })
      .from(organizations)
      .where(eq(organizations.id, input.organizationId))
      .limit(1)
      .for("update");
    if (!organization) {
      throw new DeletionError("not_found", "Workspace not found.");
    }
    await requireOrganizationAdmin(tx, organization.id, input.actorUserId, "owner");

    if (input.confirmation.trim() !== organization.slug) {
      // Refusal happens whether or not a deletion is already scheduled: a form
      // that silently "succeeds" with the wrong word teaches the wrong lesson
      // about a button that destroys a workspace.
      throw new DeletionError(
        "confirmation_mismatch",
        `Type the workspace address exactly (${organization.slug}) to confirm.`
      );
    }

    if (organization.deletionScheduledFor) {
      return { alreadyRequested: true, scheduledFor: organization.deletionScheduledFor };
    }

    const schedule = scheduleFrom(now);
    await tx
      .update(organizations)
      .set({
        deletionRequestedAt: schedule.requestedAt,
        deletionScheduledFor: schedule.scheduledFor,
        deletionRequestedByUserId: input.actorUserId,
        updatedAt: now,
      })
      .where(eq(organizations.id, organization.id));

    await tx.insert(auditLogs).values({
      id: auditId(),
      organizationId: organization.id,
      actorUserId: input.actorUserId,
      action: "organization.deletion.requested",
      targetType: "organization",
      targetId: organization.id,
      metadata: {
        slug: organization.slug,
        name: organization.name,
        scheduledFor: schedule.scheduledFor.toISOString(),
        graceDays: DELETION_GRACE_DAYS,
      },
      createdAt: now,
    });

    return { alreadyRequested: false, scheduledFor: schedule.scheduledFor };
  });
}

export async function cancelOrganizationDeletion(
  db: DbClient,
  input: { organizationId: string; actorUserId: string; now?: Date }
): Promise<void> {
  const now = input.now ?? new Date();
  await db.transaction(async (tx) => {
    const [organization] = await tx
      .select({
        id: organizations.id,
        slug: organizations.slug,
        name: organizations.name,
        deletionScheduledFor: organizations.deletionScheduledFor,
      })
      .from(organizations)
      .where(eq(organizations.id, input.organizationId))
      .limit(1)
      .for("update");
    if (!organization) throw new DeletionError("not_found", "Workspace not found.");
    await requireOrganizationAdmin(tx, organization.id, input.actorUserId, "owner");
    if (!organization.deletionScheduledFor) {
      throw new DeletionError("not_scheduled", "This workspace is not scheduled for deletion.");
    }

    await tx
      .update(organizations)
      .set({
        deletionRequestedAt: null,
        deletionScheduledFor: null,
        deletionRequestedByUserId: null,
        updatedAt: now,
      })
      .where(eq(organizations.id, organization.id));

    await tx.insert(auditLogs).values({
      id: auditId(),
      organizationId: organization.id,
      actorUserId: input.actorUserId,
      action: "organization.deletion.cancelled",
      targetType: "organization",
      targetId: organization.id,
      metadata: {
        slug: organization.slug,
        wasScheduledFor: organization.deletionScheduledFor.toISOString(),
      },
      createdAt: now,
    });
  });
}

export interface ProjectDeletionRequest {
  alreadyRequested: boolean;
  scheduledFor: Date;
}

export async function requestProjectDeletion(
  db: DbClient,
  input: {
    projectId: string;
    actorUserId: string;
    confirmation: string;
    now?: Date;
  }
): Promise<ProjectDeletionRequest> {
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    const [project] = await tx
      .select({
        id: projects.id,
        slug: projects.slug,
        name: projects.name,
        organizationId: projects.organizationId,
        deletionScheduledFor: projects.deletionScheduledFor,
      })
      .from(projects)
      .where(eq(projects.id, input.projectId))
      .limit(1)
      .for("update");
    if (!project) throw new DeletionError("not_found", "Project not found.");
    await requireOrganizationAdmin(tx, project.organizationId, input.actorUserId, "admin");

    const [organization] = await tx
      .select({ deletionScheduledFor: organizations.deletionScheduledFor })
      .from(organizations)
      .where(eq(organizations.id, project.organizationId))
      .limit(1);
    if (organization?.deletionScheduledFor) {
      throw new DeletionError(
        "organization_pending_deletion",
        "This workspace is already scheduled for deletion; delete or cancel the workspace instead."
      );
    }

    if (input.confirmation.trim() !== project.slug) {
      throw new DeletionError(
        "confirmation_mismatch",
        `Type the project slug exactly (${project.slug}) to confirm.`
      );
    }
    if (project.deletionScheduledFor) {
      return { alreadyRequested: true, scheduledFor: project.deletionScheduledFor };
    }

    const schedule = scheduleFrom(now);
    await tx
      .update(projects)
      .set({
        deletionRequestedAt: schedule.requestedAt,
        deletionScheduledFor: schedule.scheduledFor,
        deletionRequestedByUserId: input.actorUserId,
      })
      .where(eq(projects.id, project.id));

    await tx.insert(auditLogs).values({
      id: auditId(),
      organizationId: project.organizationId,
      projectId: project.id,
      actorUserId: input.actorUserId,
      action: "project.deletion.requested",
      targetType: "project",
      targetId: project.id,
      metadata: {
        slug: project.slug,
        name: project.name,
        scheduledFor: schedule.scheduledFor.toISOString(),
        graceDays: DELETION_GRACE_DAYS,
      },
      createdAt: now,
    });

    return { alreadyRequested: false, scheduledFor: schedule.scheduledFor };
  });
}

export async function cancelProjectDeletion(
  db: DbClient,
  input: { projectId: string; actorUserId: string; now?: Date }
): Promise<void> {
  const now = input.now ?? new Date();
  await db.transaction(async (tx) => {
    const [project] = await tx
      .select({
        id: projects.id,
        slug: projects.slug,
        organizationId: projects.organizationId,
        deletionScheduledFor: projects.deletionScheduledFor,
      })
      .from(projects)
      .where(eq(projects.id, input.projectId))
      .limit(1)
      .for("update");
    if (!project) throw new DeletionError("not_found", "Project not found.");
    await requireOrganizationAdmin(tx, project.organizationId, input.actorUserId, "admin");
    if (!project.deletionScheduledFor) {
      throw new DeletionError("not_scheduled", "This project is not scheduled for deletion.");
    }

    await tx
      .update(projects)
      .set({
        deletionRequestedAt: null,
        deletionScheduledFor: null,
        deletionRequestedByUserId: null,
      })
      .where(eq(projects.id, project.id));

    await tx.insert(auditLogs).values({
      id: auditId(),
      organizationId: project.organizationId,
      projectId: project.id,
      actorUserId: input.actorUserId,
      action: "project.deletion.cancelled",
      targetType: "project",
      targetId: project.id,
      metadata: { slug: project.slug },
      createdAt: now,
    });
  });
}

export interface AccountDeletionRequest {
  alreadyRequested: boolean;
  scheduledFor: Date;
  /** Workspaces that will go with the account, because nobody else is in them. */
  organizationsDeleted: Array<{ id: string; name: string; slug: string }>;
}

/**
 * Schedule the signed-in person's own account for deletion.
 *
 * Refused while they are the sole owner of a workspace somebody else belongs
 * to: deleting that membership would leave a workspace nobody can administer,
 * and the product already has ownership transfer for exactly this. Workspaces
 * where they are the only member are listed and go with the account.
 */
export async function requestAccountDeletion(
  db: DbClient,
  input: { userId: string; confirmation: string; now?: Date }
): Promise<AccountDeletionRequest> {
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    const [user] = await tx
      .select({
        id: users.id,
        email: users.email,
        deletionScheduledFor: users.deletionScheduledFor,
      })
      .from(users)
      .where(eq(users.id, input.userId))
      .limit(1)
      .for("update");
    if (!user) throw new DeletionError("not_found", "Account not found.");

    if (input.confirmation.trim().toLowerCase() !== user.email.toLowerCase()) {
      throw new DeletionError(
        "confirmation_mismatch",
        "Type your account email address exactly to confirm."
      );
    }

    const owned = await tx
      .select({ id: organizations.id, name: organizations.name, slug: organizations.slug })
      .from(organizations)
      .innerJoin(organizationMembers, eq(organizationMembers.organizationId, organizations.id))
      .where(and(eq(organizationMembers.userId, user.id), eq(organizationMembers.role, "owner")));

    const memberCounts = await tx
      .select({
        organizationId: organizationMembers.organizationId,
        members: sql<number>`count(*)`,
      })
      .from(organizationMembers)
      .where(
        owned.length > 0
          ? inArray(
              organizationMembers.organizationId,
              owned.map((row) => row.id)
            )
          : sql`false`
      )
      .groupBy(organizationMembers.organizationId);

    const counts = new Map(memberCounts.map((row) => [row.organizationId, Number(row.members)]));
    const blocked = owned.filter((row) => (counts.get(row.id) ?? 0) > 1);
    if (blocked.length > 0) {
      throw new DeletionError(
        "sole_owner",
        `Transfer ownership of ${blocked.map((row) => row.name).join(", ")} to another member before deleting your account.`,
        { blockingOrganizations: blocked.map((row) => ({ id: row.id, name: row.name })) }
      );
    }

    if (user.deletionScheduledFor) {
      return {
        alreadyRequested: true,
        scheduledFor: user.deletionScheduledFor,
        organizationsDeleted: owned,
      };
    }

    const schedule = scheduleFrom(now);
    await tx
      .update(users)
      .set({
        deletionRequestedAt: schedule.requestedAt,
        deletionScheduledFor: schedule.scheduledFor,
        updatedAt: now,
      })
      .where(eq(users.id, user.id));

    await tx.insert(auditLogs).values({
      id: auditId(),
      organizationId: null,
      actorUserId: user.id,
      action: "account.deletion.requested",
      targetType: "user",
      targetId: user.id,
      metadata: {
        email: user.email,
        scheduledFor: schedule.scheduledFor.toISOString(),
        graceDays: DELETION_GRACE_DAYS,
        organizationsDeleted: owned.map((row) => row.slug),
      },
      createdAt: now,
    });

    return {
      alreadyRequested: false,
      scheduledFor: schedule.scheduledFor,
      organizationsDeleted: owned,
    };
  });
}

export async function cancelAccountDeletion(
  db: DbClient,
  input: { userId: string; now?: Date }
): Promise<void> {
  const now = input.now ?? new Date();
  await db.transaction(async (tx) => {
    const [user] = await tx
      .select({
        id: users.id,
        email: users.email,
        deletionScheduledFor: users.deletionScheduledFor,
      })
      .from(users)
      .where(eq(users.id, input.userId))
      .limit(1)
      .for("update");
    if (!user) throw new DeletionError("not_found", "Account not found.");
    if (!user.deletionScheduledFor) {
      throw new DeletionError("not_scheduled", "This account is not scheduled for deletion.");
    }
    await tx
      .update(users)
      .set({ deletionRequestedAt: null, deletionScheduledFor: null, updatedAt: now })
      .where(eq(users.id, user.id));
    await tx.insert(auditLogs).values({
      id: auditId(),
      organizationId: null,
      actorUserId: user.id,
      action: "account.deletion.cancelled",
      targetType: "user",
      targetId: user.id,
      metadata: { email: user.email },
      createdAt: now,
    });
  });
}

export interface PurgeSummary {
  organizationsPurged: number;
  projectsPurged: number;
  accountsPurged: number;
  failures: Array<{ target: string; error: string }>;
  /**
   * True when a bound stopped the run. The next tick continues; the log never
   * claims the queue is empty when it is not.
   */
  truncated: boolean;
}

export interface PurgeOptions {
  maxPerRun?: number;
  /** Restrict to these organisations/users (targeted repair and tests). */
  organizationIds?: string[];
  projectIds?: string[];
  userIds?: string[];
}

/**
 * Destroy everything whose grace window has passed.
 *
 * Order matters: accounts first would delete memberships that organisation
 * purges are counting on, so organisations go first, then projects that were
 * deleted on their own, then accounts.
 */
export async function purgeDueDeletions(
  db: DbClient,
  now: Date = new Date(),
  options: PurgeOptions = {}
): Promise<PurgeSummary> {
  const maxPerRun = options.maxPerRun ?? DEFAULT_MAX_PER_RUN;
  const summary: PurgeSummary = {
    organizationsPurged: 0,
    projectsPurged: 0,
    accountsPurged: 0,
    failures: [],
    truncated: false,
  };

  const dueOrganizations = await db
    .select({ id: organizations.id, slug: organizations.slug, name: organizations.name })
    .from(organizations)
    .where(
      options.organizationIds
        ? and(
            isNotNull(organizations.deletionScheduledFor),
            lte(organizations.deletionScheduledFor, now),
            inArray(organizations.id, options.organizationIds)
          )
        : and(
            isNotNull(organizations.deletionScheduledFor),
            lte(organizations.deletionScheduledFor, now)
          )
    )
    .limit(maxPerRun + 1);

  if (dueOrganizations.length > maxPerRun) summary.truncated = true;
  for (const organization of dueOrganizations.slice(0, maxPerRun)) {
    try {
      await purgeOrganization(db, organization, now);
      summary.organizationsPurged += 1;
    } catch (error) {
      summary.failures.push({
        target: `organization:${organization.id}`,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const dueProjects = await db
    .select({
      id: projects.id,
      slug: projects.slug,
      name: projects.name,
      organizationId: projects.organizationId,
    })
    .from(projects)
    .where(
      options.projectIds
        ? and(
            isNotNull(projects.deletionScheduledFor),
            lte(projects.deletionScheduledFor, now),
            inArray(projects.id, options.projectIds)
          )
        : and(isNotNull(projects.deletionScheduledFor), lte(projects.deletionScheduledFor, now))
    )
    .limit(maxPerRun + 1);

  if (dueProjects.length > maxPerRun) summary.truncated = true;
  for (const project of dueProjects.slice(0, maxPerRun)) {
    try {
      await purgeProject(db, project, now);
      summary.projectsPurged += 1;
    } catch (error) {
      summary.failures.push({
        target: `project:${project.id}`,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const dueAccounts = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(
      options.userIds
        ? and(
            isNotNull(users.deletionScheduledFor),
            lte(users.deletionScheduledFor, now),
            inArray(users.id, options.userIds)
          )
        : and(isNotNull(users.deletionScheduledFor), lte(users.deletionScheduledFor, now))
    )
    .limit(maxPerRun + 1);

  if (dueAccounts.length > maxPerRun) summary.truncated = true;
  for (const account of dueAccounts.slice(0, maxPerRun)) {
    try {
      await purgeAccount(db, account, now);
      summary.accountsPurged += 1;
    } catch (error) {
      summary.failures.push({
        target: `account:${account.id}`,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return summary;
}

async function purgeOrganization(
  db: DbClient,
  organization: { id: string; slug: string; name: string },
  now: Date
): Promise<void> {
  await db.transaction((tx) => purgeOrganizationIn(tx, organization, now));
}

async function purgeOrganizationIn(
  tx: DbExecutor,
  organization: { id: string; slug: string; name: string },
  now: Date
): Promise<void> {
  {
    const members = await tx
      .select({ value: sql<number>`count(*)` })
      .from(organizationMembers)
      .where(eq(organizationMembers.organizationId, organization.id));
    const projectRows = await tx
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.organizationId, organization.id));

    // Written before the delete: the FK is ON DELETE SET NULL, so this row
    // outlives the workspace and its metadata is the only remaining record of
    // which workspace it was.
    await tx.insert(auditLogs).values({
      id: auditId(),
      organizationId: organization.id,
      actorUserId: null,
      action: "organization.deletion.purged",
      targetType: "organization",
      targetId: organization.id,
      metadata: {
        organizationId: organization.id,
        slug: organization.slug,
        name: organization.name,
        projects: projectRows.length,
        members: Number(members[0]?.value ?? 0),
        purgedAt: now.toISOString(),
      },
      createdAt: now,
    });

    const deleted = await tx
      .delete(organizations)
      .where(eq(organizations.id, organization.id))
      .returning({ id: organizations.id });
    if (deleted.length === 0) {
      throw new Error("organization disappeared before it could be purged");
    }
  }
}

async function purgeProject(
  db: DbClient,
  project: { id: string; slug: string; name: string; organizationId: string },
  now: Date
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.insert(auditLogs).values({
      id: auditId(),
      organizationId: project.organizationId,
      projectId: project.id,
      actorUserId: null,
      action: "project.deletion.purged",
      targetType: "project",
      targetId: project.id,
      metadata: {
        projectId: project.id,
        slug: project.slug,
        name: project.name,
        purgedAt: now.toISOString(),
      },
      createdAt: now,
    });
    const deleted = await tx
      .delete(projects)
      .where(eq(projects.id, project.id))
      .returning({ id: projects.id });
    if (deleted.length === 0) {
      throw new Error("project disappeared before it could be purged");
    }
  });
}

async function purgeAccount(
  db: DbClient,
  account: { id: string; email: string },
  now: Date
): Promise<void> {
  await db.transaction(async (tx) => {
    // Workspaces where this person is the only member go with them; a
    // workspace with other people in it was refused at request time.
    const soloMemberships = await tx
      .select({ organizationId: organizationMembers.organizationId })
      .from(organizationMembers)
      .where(eq(organizationMembers.userId, account.id));
    const soloOrganizations: Array<{ id: string; slug: string; name: string }> = [];
    for (const membership of soloMemberships) {
      const [countRow] = await tx
        .select({ value: sql<number>`count(*)` })
        .from(organizationMembers)
        .where(eq(organizationMembers.organizationId, membership.organizationId));
      if (Number(countRow?.value ?? 0) !== 1) continue;
      const [organization] = await tx
        .select({ id: organizations.id, slug: organizations.slug, name: organizations.name })
        .from(organizations)
        .where(eq(organizations.id, membership.organizationId))
        .limit(1);
      if (organization) soloOrganizations.push(organization);
    }

    for (const organization of soloOrganizations) {
      await purgeOrganizationIn(tx, organization, now);
    }

    await tx.insert(auditLogs).values({
      id: auditId(),
      organizationId: null,
      actorUserId: account.id,
      action: "account.deletion.purged",
      targetType: "user",
      targetId: account.id,
      metadata: {
        userId: account.id,
        email: account.email,
        organizationsDeleted: soloOrganizations.map((row) => row.slug),
        purgedAt: now.toISOString(),
      },
      createdAt: now,
    });

    const deleted = await tx
      .delete(users)
      .where(eq(users.id, account.id))
      .returning({ id: users.id });
    if (deleted.length === 0) {
      throw new Error("account disappeared before it could be purged");
    }
  });
}

/** Anything of this person's already scheduled? Drives the settings banner. */
export async function accountDeletionStatus(
  db: DbClient,
  userId: string,
  now: Date = new Date()
): Promise<DeletionStatus> {
  const [row] = await db
    .select({
      deletionRequestedAt: users.deletionRequestedAt,
      deletionScheduledFor: users.deletionScheduledFor,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return row
    ? deletionStatusFrom(row, now)
    : { pending: false, requestedAt: null, scheduledFor: null, daysRemaining: null };
}

export async function organizationDeletionStatus(
  db: DbClient,
  organizationId: string,
  now: Date = new Date()
): Promise<DeletionStatus> {
  const [row] = await db
    .select({
      deletionRequestedAt: organizations.deletionRequestedAt,
      deletionScheduledFor: organizations.deletionScheduledFor,
    })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);
  return row
    ? deletionStatusFrom(row, now)
    : { pending: false, requestedAt: null, scheduledFor: null, daysRemaining: null };
}
