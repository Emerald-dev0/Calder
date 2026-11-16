/**
 * Abuse review: the queue an operator works through, and the decisions they
 * record.
 *
 * Automatic pausing already exists — `evaluateOrganizationAbusePolicy` turns a
 * bounce or complaint rate into `abuse_paused` and mails the workspace. What
 * was missing was everything after that: a list of what needs a human, a place
 * to write down *why* a decision was taken, and a way back that is not
 * "suspend or resume, with no record of who decided or what they saw".
 *
 * The rules this module enforces:
 *
 *  - **A decision needs a reason.** `note` is required and is written into the
 *    audit row, because an enforcement action nobody can explain afterwards is
 *    indistinguishable from an accident.
 *  - **Attribution is stored, not inferred.** Every row carries the operator's
 *    user id, the previous state and the new one. "Who paused this?" has an
 *    answer six months later.
 *  - **Every action is reversible.** `reinstate` returns a workspace to active
 *    sending; suspension revokes keys (deliberately — they were the vector) and
 *    the reason is recorded so the next operator knows why the customer had to
 *    recreate them.
 *  - **Repeating a decision is not an error.** Asking for the state a workspace
 *    is already in returns `changed: false` instead of writing a second audit
 *    row that would look like two decisions.
 *
 * The queue is deliberately three groups, not one number: workspaces the policy
 * paused, workspaces a person suspended, and workspaces that are still sending
 * but produced complaints recently ("watching"). Collapsing those would let a
 * healthy-but-noisy workspace hide behind a verdict someone already made.
 */
import { randomUUID } from "node:crypto";
import { and, count, desc, eq, gte, inArray, isNull, ne, sql } from "drizzle-orm";
import type { DbClient } from "./client.js";
import { auditLogs } from "./schema/system.js";
import { emails } from "./schema/emails.js";
import { organizations } from "./schema/organizations.js";
import { projects } from "./schema/projects.js";
import { apiKeys } from "./schema/api-keys.js";

/** Review verdicts. `reinstate` is the only one that restores sending. */
export const ABUSE_REVIEW_ACTIONS = ["reinstate", "pause", "suspend"] as const;
export type AbuseReviewAction = (typeof ABUSE_REVIEW_ACTIONS)[number];

/** Audit actions this module writes. Exported so surfaces can filter on them. */
export const ABUSE_REVIEW_AUDIT_ACTIONS = [
  "organization.sending.reinstated",
  "organization.sending.paused",
  "organization.sending.suspended",
  "organization.abuse.note",
] as const;

const STATUS_FOR_ACTION: Record<AbuseReviewAction, "active" | "abuse_paused" | "suspended"> = {
  reinstate: "active",
  pause: "abuse_paused",
  suspend: "suspended",
};

const DAY_MS = 24 * 60 * 60 * 1000;

export class AbuseReviewError extends Error {
  readonly statusCode: number;

  constructor(
    readonly code: "not_found" | "note_required" | "unsupported_action",
    message: string,
    statusCode = 400
  ) {
    super(message);
    this.name = "AbuseReviewError";
    this.statusCode = statusCode;
  }
}

export interface AbuseMetrics {
  /** Messages accepted in the window (all statuses). The denominator. */
  sent: number;
  bounced: number;
  complained: number;
  bounceRate: number;
  complaintRate: number;
}

export interface AbuseReviewQueueEntry {
  organizationId: string;
  name: string;
  slug: string;
  status: "active" | "abuse_paused" | "suspended";
  statusReason: string | null;
  statusChangedAt: Date | null;
  /**
   * Why this workspace is in the queue:
   *  - `auto_paused` — our own policy paused it;
   *  - `suspended`   — an operator suspended it;
   *  - `watching`    — still active, but complaints arrived recently.
   */
  reason: "auto_paused" | "suspended" | "watching";
  metrics: AbuseMetrics;
  /** Most recent review row (decision or note), for "who last touched this". */
  lastReview: {
    action: string;
    note: string | null;
    actorUserId: string | null;
    at: Date;
  } | null;
}

export interface AbuseReviewQueueOptions {
  now?: Date;
  /** Metric window. Short enough to reflect current reputation. */
  windowDays?: number;
  limit?: number;
}

/**
 * What needs an operator's attention, worst first.
 *
 * `watching` is included on purpose: an active workspace with complaints in the
 * window is one bad day away from an automatic pause, and an operator who only
 * ever sees paused workspaces is always reading the news late.
 */
export async function listAbuseReviewQueue(
  db: DbClient,
  options: AbuseReviewQueueOptions = {}
): Promise<AbuseReviewQueueEntry[]> {
  const now = options.now ?? new Date();
  const windowDays = options.windowDays ?? 7;
  const limit = options.limit ?? 50;
  const since = new Date(now.getTime() - windowDays * DAY_MS);

  const nonActive = await db
    .select({
      id: organizations.id,
      name: organizations.name,
      slug: organizations.slug,
      status: organizations.sendingStatus,
      reason: organizations.sendingStatusReason,
      at: organizations.sendingStatusAt,
    })
    .from(organizations)
    .where(ne(organizations.sendingStatus, "active"))
    .orderBy(desc(organizations.sendingStatusAt))
    .limit(limit);

  const complaining = await db
    .select({ organizationId: projects.organizationId })
    .from(emails)
    .innerJoin(projects, eq(projects.id, emails.projectId))
    .where(and(eq(emails.status, "complained"), gte(emails.createdAt, since)))
    .groupBy(projects.organizationId)
    .limit(limit);

  const candidateIds = new Set<string>([...nonActive.map((row) => row.id)]);
  for (const row of complaining) candidateIds.add(row.organizationId);

  if (candidateIds.size === 0) return [];

  const ids = [...candidateIds];
  const metricsRows = await db
    .select({
      organizationId: projects.organizationId,
      sent: count(),
      bounced: sql<number>`count(*) filter (where ${emails.status} = 'bounced')`,
      complained: sql<number>`count(*) filter (where ${emails.status} = 'complained')`,
    })
    .from(emails)
    .innerJoin(projects, eq(projects.id, emails.projectId))
    .where(and(inArray(projects.organizationId, ids), gte(emails.createdAt, since)))
    .groupBy(projects.organizationId);
  const metricsById = new Map(metricsRows.map((row) => [row.organizationId, row]));

  const activeNames = await db
    .select({ id: organizations.id, name: organizations.name, slug: organizations.slug })
    .from(organizations)
    .where(
      inArray(
        organizations.id,
        complaining.map((row) => row.organizationId)
      )
    );

  const reviews = await db
    .select({
      organizationId: auditLogs.organizationId,
      action: auditLogs.action,
      metadata: auditLogs.metadata,
      actorUserId: auditLogs.actorUserId,
      createdAt: auditLogs.createdAt,
    })
    .from(auditLogs)
    .where(
      and(
        inArray(auditLogs.organizationId, ids),
        inArray(auditLogs.action, [...ABUSE_REVIEW_AUDIT_ACTIONS])
      )
    )
    .orderBy(desc(auditLogs.createdAt));

  const lastReview = new Map<string, (typeof reviews)[number]>();
  for (const row of reviews) {
    if (row.organizationId && !lastReview.has(row.organizationId))
      lastReview.set(row.organizationId, row);
  }

  const entries: AbuseReviewQueueEntry[] = [];

  for (const organization of nonActive) {
    const metrics = metricsFor(metricsById.get(organization.id));
    const review = lastReview.get(organization.id);
    entries.push({
      organizationId: organization.id,
      name: organization.name,
      slug: organization.slug,
      status: organization.status,
      statusReason: organization.reason,
      statusChangedAt: organization.at,
      reason: organization.status === "abuse_paused" ? "auto_paused" : "suspended",
      metrics,
      lastReview: review
        ? {
            action: review.action,
            note: typeof review.metadata?.note === "string" ? review.metadata.note : null,
            actorUserId: review.actorUserId,
            at: review.createdAt,
          }
        : null,
    });
  }

  const alreadyQueued = new Set(nonActive.map((row) => row.id));
  for (const organization of activeNames) {
    if (alreadyQueued.has(organization.id)) continue;
    const metrics = metricsFor(metricsById.get(organization.id));
    if (metrics.complained === 0) continue;
    const review = lastReview.get(organization.id);
    entries.push({
      organizationId: organization.id,
      name: organization.name,
      slug: organization.slug,
      status: "active",
      statusReason: null,
      statusChangedAt: null,
      reason: "watching",
      metrics,
      lastReview: review
        ? {
            action: review.action,
            note: typeof review.metadata?.note === "string" ? review.metadata.note : null,
            actorUserId: review.actorUserId,
            at: review.createdAt,
          }
        : null,
    });
  }

  const severity = (entry: AbuseReviewQueueEntry): number =>
    entry.status === "suspended" ? 0 : entry.status === "abuse_paused" ? 1 : 2;

  return entries
    .sort((a, b) => {
      const bySeverity = severity(a) - severity(b);
      if (bySeverity !== 0) return bySeverity;
      return (
        b.metrics.complaintRate +
        b.metrics.bounceRate -
        (a.metrics.complaintRate + a.metrics.bounceRate)
      );
    })
    .slice(0, limit);
}

function metricsFor(row?: { sent: number; bounced: number; complained: number }): AbuseMetrics {
  const sent = Number(row?.sent ?? 0);
  const bounced = Number(row?.bounced ?? 0);
  const complained = Number(row?.complained ?? 0);
  return {
    sent,
    bounced,
    complained,
    bounceRate: sent > 0 ? bounced / sent : 0,
    complaintRate: sent > 0 ? complained / sent : 0,
  };
}

export interface AbuseReviewDecision {
  changed: boolean;
  from: "active" | "abuse_paused" | "suspended";
  to: "active" | "abuse_paused" | "suspended";
  /** Keys revoked by a suspension; zero for every other action. */
  revokedKeyCount: number;
}

/**
 * Record and apply one review decision.
 *
 * The note is mandatory and lands in the audit row. Applying the state a
 * workspace already has returns `changed: false` and writes nothing — two audit
 * rows for one decision is how a review history becomes unreadable.
 */
export async function applyAbuseReviewDecision(
  db: DbClient,
  input: {
    organizationId: string;
    action: AbuseReviewAction;
    note: string;
    actorUserId: string | null;
    now?: Date;
  }
): Promise<AbuseReviewDecision> {
  const now = input.now ?? new Date();
  const note = input.note.trim();
  if (note.length < 6) {
    throw new AbuseReviewError(
      "note_required",
      "A review decision needs a note of at least 6 characters — it is what the next operator reads."
    );
  }
  if (note.length > 500) {
    throw new AbuseReviewError("note_required", "Keep the note under 500 characters.");
  }
  if (!ABUSE_REVIEW_ACTIONS.includes(input.action)) {
    throw new AbuseReviewError("unsupported_action", "Unsupported review action.");
  }
  const target = STATUS_FOR_ACTION[input.action];

  return db.transaction(async (tx) => {
    const [organization] = await tx
      .select({
        id: organizations.id,
        slug: organizations.slug,
        name: organizations.name,
        sendingStatus: organizations.sendingStatus,
      })
      .from(organizations)
      .where(eq(organizations.id, input.organizationId))
      .limit(1)
      .for("update");
    if (!organization) throw new AbuseReviewError("not_found", "Workspace not found.", 404);

    if (organization.sendingStatus === target) {
      return { changed: false, from: organization.sendingStatus, to: target, revokedKeyCount: 0 };
    }

    let revokedKeyCount = 0;
    if (input.action === "suspend") {
      const orgProjects = await tx
        .select({ id: projects.id })
        .from(projects)
        .where(eq(projects.organizationId, organization.id));
      const projectIds = orgProjects.map((project) => project.id);
      if (projectIds.length > 0) {
        const revoked = await tx
          .update(apiKeys)
          .set({ revokedAt: now })
          .where(and(inArray(apiKeys.projectId, projectIds), isNull(apiKeys.revokedAt)))
          .returning({ id: apiKeys.id });
        revokedKeyCount = revoked.length;
      }
    }

    await tx
      .update(organizations)
      .set({
        sendingStatus: target,
        sendingStatusReason: note,
        sendingStatusAt: now,
        sendingStatusActorUserId: input.actorUserId,
        updatedAt: now,
      })
      .where(eq(organizations.id, organization.id));

    await tx.insert(auditLogs).values({
      id: `audit_${randomUUID().replace(/-/g, "").slice(0, 24)}`,
      organizationId: organization.id,
      actorUserId: input.actorUserId,
      action:
        input.action === "reinstate"
          ? "organization.sending.reinstated"
          : input.action === "pause"
            ? "organization.sending.paused"
            : "organization.sending.suspended",
      targetType: "organization",
      targetId: organization.id,
      metadata: {
        from: organization.sendingStatus,
        to: target,
        decision: input.action,
        note,
        actor: "abuse_review",
        revokedKeyCount,
        slug: organization.slug,
        name: organization.name,
      },
      createdAt: now,
    });

    return {
      changed: true,
      from: organization.sendingStatus,
      to: target,
      revokedKeyCount,
    };
  });
}

/** A note that does not change sending state: what was checked, what was seen. */
export async function addAbuseReviewNote(
  db: DbClient,
  input: { organizationId: string; note: string; actorUserId: string | null; now?: Date }
): Promise<{ id: string }> {
  const now = input.now ?? new Date();
  const note = input.note.trim();
  if (note.length < 6 || note.length > 2000) {
    throw new AbuseReviewError("note_required", "A note must be between 6 and 2000 characters.");
  }

  const [organization] = await db
    .select({ id: organizations.id, slug: organizations.slug })
    .from(organizations)
    .where(eq(organizations.id, input.organizationId))
    .limit(1);
  if (!organization) throw new AbuseReviewError("not_found", "Workspace not found.", 404);

  const id = `audit_${randomUUID().replace(/-/g, "").slice(0, 24)}`;
  await db.insert(auditLogs).values({
    id,
    organizationId: organization.id,
    actorUserId: input.actorUserId,
    action: "organization.abuse.note",
    targetType: "organization",
    targetId: organization.id,
    metadata: { note, slug: organization.slug },
    createdAt: now,
  });
  return { id };
}

export interface AbuseReviewHistoryRow {
  id: string;
  action: string;
  note: string | null;
  from: string | null;
  to: string | null;
  actorUserId: string | null;
  at: Date;
}

/** Newest first. This is what "reversible" has to mean in practice. */
export async function abuseReviewHistory(
  db: DbClient,
  organizationId: string,
  limit = 20
): Promise<AbuseReviewHistoryRow[]> {
  const rows = await db
    .select({
      id: auditLogs.id,
      action: auditLogs.action,
      metadata: auditLogs.metadata,
      actorUserId: auditLogs.actorUserId,
      createdAt: auditLogs.createdAt,
    })
    .from(auditLogs)
    .where(
      and(
        eq(auditLogs.organizationId, organizationId),
        inArray(auditLogs.action, [...ABUSE_REVIEW_AUDIT_ACTIONS])
      )
    )
    .orderBy(desc(auditLogs.createdAt))
    .limit(limit);

  return rows.map((row) => ({
    id: row.id,
    action: row.action,
    note: typeof row.metadata?.note === "string" ? row.metadata.note : null,
    from: typeof row.metadata?.from === "string" ? row.metadata.from : null,
    to: typeof row.metadata?.to === "string" ? row.metadata.to : null,
    actorUserId: row.actorUserId,
    at: row.createdAt,
  }));
}

/**
 * Operators who may enforce. Support and analyst roles can read the queue but
 * not change a workspace's sending state — an enforcement action that any
 * read-only role can take is not an enforcement action.
 */
export const ABUSE_REVIEW_ROLES = ["founder", "platform_admin", "security"] as const;

export function canEnforceAbuseReview(role: string | null | undefined): boolean {
  return !!role && (ABUSE_REVIEW_ROLES as readonly string[]).includes(role);
}
