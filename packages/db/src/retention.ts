/**
 * Retention enforcement — the plan's `retentionDays`, applied.
 *
 * `retentionDays` (7 / 14 / 30 / 90, or `null` for contract plans) has been
 * catalogue data since the pricing table was written: every plan page promised
 * it, and nothing ever deleted or redacted anything. A Beginner workspace
 * therefore held message bodies indefinitely, which is both a privacy problem
 * (we keep more of a customer's content than we told them) and a slow cost
 * problem (bodies, attachments and every provider event, forever).
 *
 * What happens at the boundary, and why:
 *
 *  - **The body goes.** `subject`, `html`, `text`, `attachments`, `cc`, `bcc`
 *    and `metadata` are cleared; the subject is replaced with a visible marker
 *    rather than blanked, because a blank subject in a list reads like a bug
 *    and invites someone to "fix" it by re-sending.
 *  - **The timeline goes.** `email_events` for that message are deleted — the
 *    provider payloads carry recipient and diagnostic detail, and once the
 *    message is past the boundary there is nothing left to investigate.
 *  - **The accounting row stays.** id, project, from/to, status, provider,
 *    attempt count and timestamps survive, so usage totals, delivery rates and
 *    the customer's own history stay correct. Deleting them would rewrite
 *    numbers the customer has already been billed against.
 *
 * Two deliberate refusals:
 *
 *  - **Nothing is redacted while the message could still be sent.** A queued,
 *    claimed or retrying (`deferred`) message older than the boundary keeps its
 *    body; emptying it would deliver an envelope with no content. Only terminal
 *    statuses are eligible, so a long backoff can never eat a message.
 *  - **`retentionDays: null` means "do not touch".** A contract plan with no
 *    number is not an invitation to guess a default.
 *
 * The sweep is bounded per run (`maxOrganizations`, `maxEmailsPerOrganization`)
 * and idempotent: the subject marker excludes already-redacted rows, deleted
 * events are gone, and a second run reports zero work. One organisation's
 * failure is recorded and the sweep continues.
 */
import { and, eq, gt, inArray, lt, ne, sql } from "drizzle-orm";
import { planFor } from "@calder/config";
import type { DbClient } from "./client.js";
import { emails, emailEvents } from "./schema/emails.js";
import { organizations } from "./schema/organizations.js";
import { projects } from "./schema/projects.js";
import { resolveOrgTier } from "./usage.js";

/**
 * Shown in place of a redacted subject. Deliberately not empty: a blank
 * subject looks like corruption, and someone will eventually "repair" it.
 */
export const RETENTION_SUBJECT_PLACEHOLDER = "(removed by retention)";

/**
 * Finished states. Everything else (`created`, `queued`, `sending`, `deferred`)
 * can still produce a send, so its body must survive.
 */
export const RETENTION_ELIGIBLE_STATUSES = [
  "sent",
  "delivered",
  "bounced",
  "complained",
  "failed",
  "suppressed",
] as const;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface OrgRetentionResult {
  organizationId: string;
  tier: string;
  /** `null` = contract plan; nothing was touched. */
  retentionDays: number | null;
  redacted: number;
  eventsDeleted: number;
}

export interface RetentionSweepSummary {
  /** Organisations whose retention window is a number and was applied. */
  organizationsEnforced: number;
  /** Organisations on a contract plan (`null`), deliberately untouched. */
  organizationsUnlimited: number;
  redacted: number;
  eventsDeleted: number;
  /** Per-organisation detail for the ones that did work (and failures). */
  results: OrgRetentionResult[];
  failures: Array<{ organizationId: string; error: string }>;
  /**
   * True when a bound stopped the sweep early (more organisations or more
   * rows were waiting). Reported rather than claimed complete — a cron log
   * that says "done" when it stopped at a cap is a lie the next run inherits.
   */
  truncated: boolean;
  /** Where the next run should resume, when `truncated` is true. */
  nextAfterOrganizationId: string | null;
}

export interface EnforceRetentionOptions {
  /** Resume after this organisation id (keyset pagination, stable ordering). */
  afterOrganizationId?: string | null;
  maxOrganizations?: number;
  maxEmailsPerOrganization?: number;
  /**
   * Restrict the sweep to these organisations. The scheduled sweep omits it
   * (it walks the fleet); a targeted repair, or a test that must not depend on
   * which other workspaces happen to exist, passes an explicit list.
   */
  organizationIds?: string[];
}

const DEFAULT_MAX_ORGANIZATIONS = 200;
const DEFAULT_MAX_EMAILS = 500;

/**
 * Apply every plan's retention window once.
 *
 * Callers: `runScheduledMaintenance` (daily) and the manual cron endpoint. Safe
 * to run concurrently with itself — the guards are all in the SQL.
 */
export async function enforceRetention(
  db: DbClient,
  now: Date = new Date(),
  options: EnforceRetentionOptions = {}
): Promise<RetentionSweepSummary> {
  const maxOrganizations = options.maxOrganizations ?? DEFAULT_MAX_ORGANIZATIONS;
  const maxEmails = options.maxEmailsPerOrganization ?? DEFAULT_MAX_EMAILS;

  if (options.organizationIds && options.organizationIds.length === 0) {
    return {
      organizationsEnforced: 0,
      organizationsUnlimited: 0,
      redacted: 0,
      eventsDeleted: 0,
      results: [],
      failures: [],
      truncated: false,
      nextAfterOrganizationId: null,
    };
  }

  const orgs = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(
      options.organizationIds
        ? inArray(organizations.id, options.organizationIds)
        : options.afterOrganizationId
          ? gt(organizations.id, options.afterOrganizationId)
          : undefined
    )
    .orderBy(organizations.id)
    .limit(maxOrganizations + 1);

  const truncatedByOrgPage = orgs.length > maxOrganizations;
  const page = truncatedByOrgPage ? orgs.slice(0, maxOrganizations) : orgs;

  const summary: RetentionSweepSummary = {
    organizationsEnforced: 0,
    organizationsUnlimited: 0,
    redacted: 0,
    eventsDeleted: 0,
    results: [],
    failures: [],
    truncated: truncatedByOrgPage,
    nextAfterOrganizationId: truncatedByOrgPage ? (page[page.length - 1]?.id ?? null) : null,
  };

  let truncatedByRows = false;

  for (const org of page) {
    try {
      const tier = await resolveOrgTier(db, org.id);
      const retentionDays = planFor(tier).retentionDays;
      if (retentionDays === null) {
        summary.organizationsUnlimited += 1;
        continue;
      }
      summary.organizationsEnforced += 1;
      const cutoff = new Date(now.getTime() - retentionDays * DAY_MS);

      const redacted = await redactOrganizationEmails(db, org.id, cutoff, now, maxEmails);
      const eventsDeleted = await deleteOrganizationEvents(db, org.id, cutoff, maxEmails);
      if (redacted === maxEmails || eventsDeleted === maxEmails) truncatedByRows = true;

      summary.redacted += redacted;
      summary.eventsDeleted += eventsDeleted;
      if (redacted > 0 || eventsDeleted > 0) {
        summary.results.push({
          organizationId: org.id,
          tier,
          retentionDays,
          redacted,
          eventsDeleted,
        });
      }
    } catch (error) {
      // One tenant's bad row must not stop every other tenant's retention.
      // Recorded, not swallowed: the cron log has to show which workspace is
      // still holding data past its window.
      summary.failures.push({
        organizationId: org.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (truncatedByRows) summary.truncated = true;
  return summary;
}

/**
 * Clear bodies of terminal messages older than `cutoff`.
 *
 * Select-then-update keeps the run bounded; `RETENTION_SUBJECT_PLACEHOLDER`
 * makes the statement idempotent, so a row can never be "redacted" twice and a
 * re-run reports zero.
 */
async function redactOrganizationEmails(
  db: DbClient,
  organizationId: string,
  cutoff: Date,
  now: Date,
  limit: number
): Promise<number> {
  const projectIds = db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.organizationId, organizationId));

  const candidates = await db
    .select({ id: emails.id })
    .from(emails)
    .where(
      and(
        inArray(emails.projectId, projectIds),
        inArray(emails.status, [...RETENTION_ELIGIBLE_STATUSES]),
        lt(emails.createdAt, cutoff),
        ne(emails.subject, RETENTION_SUBJECT_PLACEHOLDER)
      )
    )
    .limit(limit);

  if (candidates.length === 0) return 0;

  const updated = await db
    .update(emails)
    .set({
      subject: RETENTION_SUBJECT_PLACEHOLDER,
      html: null,
      text: null,
      attachments: null,
      metadata: null,
      cc: null,
      bcc: null,
      updatedAt: now,
    })
    .where(
      inArray(
        emails.id,
        candidates.map((row) => row.id)
      )
    )
    .returning({ id: emails.id });

  return updated.length;
}

/**
 * Delete the timeline of messages past the boundary.
 *
 * Scoped through the message's own age and terminal status, so a queued
 * message's events survive even if some of those events are old — the queue
 * still needs the history it will append to.
 */
async function deleteOrganizationEvents(
  db: DbClient,
  organizationId: string,
  cutoff: Date,
  limit: number
): Promise<number> {
  const eligibleEmails = await db
    .select({ id: emails.id })
    .from(emails)
    .innerJoin(projects, eq(projects.id, emails.projectId))
    .where(
      and(
        eq(projects.organizationId, organizationId),
        inArray(emails.status, [...RETENTION_ELIGIBLE_STATUSES]),
        lt(emails.createdAt, cutoff)
      )
    )
    .limit(limit);

  if (eligibleEmails.length === 0) return 0;

  const deleted = await db
    .delete(emailEvents)
    .where(
      inArray(
        emailEvents.emailId,
        eligibleEmails.map((row) => row.id)
      )
    )
    .returning({ id: emailEvents.id });

  return deleted.length;
}

/**
 * How much of a workspace is past its window right now — for the Usage page
 * and for an operator asking "is retention actually running". Cheap enough to
 * call per page: two indexed counts.
 */
export async function organizationRetentionStatus(
  db: DbClient,
  organizationId: string,
  now: Date = new Date()
): Promise<{ retentionDays: number | null; tier: string; cutoff: Date | null; pending: number }> {
  const tier = await resolveOrgTier(db, organizationId);
  const retentionDays = planFor(tier).retentionDays;
  if (retentionDays === null) {
    return { retentionDays, tier, cutoff: null, pending: 0 };
  }
  const cutoff = new Date(now.getTime() - retentionDays * DAY_MS);
  const projectIds = db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.organizationId, organizationId));
  const [row] = await db
    .select({ value: sql<number>`count(*)` })
    .from(emails)
    .where(
      and(
        inArray(emails.projectId, projectIds),
        inArray(emails.status, [...RETENTION_ELIGIBLE_STATUSES]),
        lt(emails.createdAt, cutoff),
        ne(emails.subject, RETENTION_SUBJECT_PLACEHOLDER)
      )
    );
  return { retentionDays, tier, cutoff, pending: Number(row?.value ?? 0) };
}
