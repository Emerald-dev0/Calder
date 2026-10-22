/**
 * Suppression scope policy — the single place that decides whether a
 * suppressed address may receive a given stream.
 *
 * Two independent questions, deliberately separated:
 *
 *   1. WHICH STREAMS does a reason block?
 *      `unsubscribe` is a marketing preference. It must never stop a password
 *      reset, a receipt or a security alert — the recipient asked for fewer
 *      broadcasts, not for their account emails to stop. Every other reason
 *      (a hard bounce, a complaint, an operator's manual block, an imported
 *      list) blocks both streams, because delivering into a dead or hostile
 *      mailbox damages every customer sharing the sending reputation.
 *
 *   2. HOW FAR does a row reach?
 *      `bounce` and `complaint` are facts about the mailbox, not the project.
 *      Reputation is shared at the organization level, so they apply to every
 *      project in that organization. Everything else is a per-project
 *      decision and stays there.
 *
 * The two rules compose: an `unsubscribe` recorded in project A blocks
 * marketing in A only; a `bounce` recorded in A blocks everything everywhere
 * in A's organization.
 *
 * Before this module the check was `project_id = ? AND email = ?` with no
 * regard for reason or stream, which meant an unsubscribe silently swallowed
 * transactional mail, and a hard bounce in one project did not protect the
 * other projects in the same workspace.
 */

import { and, eq, inArray, or, sql } from "drizzle-orm";
import { projects } from "./schema/projects.js";
import { suppressions } from "./schema/emails.js";
import type { DbClient } from "./client.js";

/** The two email streams, mirroring the `email_stream` pg enum. */
export type EmailStream = "transactional" | "marketing";

/**
 * Reasons that follow the address across every project in the organization.
 * Deliberately a closed list: adding a reason here widens the blast radius of
 * every row with that reason, so it should be a reviewable decision.
 */
export const ORG_WIDE_SUPPRESSION_REASONS = ["bounce", "complaint"] as const;

/** Reasons a recipient set themselves. These never block transactional mail. */
export const MARKETING_ONLY_SUPPRESSION_REASONS = ["unsubscribe"] as const;

export function isOrgWideReason(reason: string): boolean {
  return (ORG_WIDE_SUPPRESSION_REASONS as readonly string[]).includes(reason);
}

export function isMarketingOnlyReason(reason: string): boolean {
  return (MARKETING_ONLY_SUPPRESSION_REASONS as readonly string[]).includes(reason);
}

/**
 * Does a suppression with `reason` block a send on `stream`?
 *
 * Pure and total: an unrecognised legacy reason is treated as a general block
 * (fail closed) rather than being ignored, because a row exists for a reason.
 */
export function blocksStream(reason: string, stream: EmailStream): boolean {
  if (isMarketingOnlyReason(reason)) return stream === "marketing";
  return true;
}

export interface BlockingSuppression {
  id: string;
  email: string;
  reason: string;
  projectId: string;
  organizationId: string | null;
  /** True when the match came from another project in the same organization. */
  crossProject: boolean;
  /** True when the reason blocks every stream (false = marketing only). */
  blocksAllStreams: boolean;
}

/**
 * Find the suppression row, if any, that must block this recipient.
 *
 * One query. The organization is derived from the sending project in SQL
 * rather than passed in, so a caller cannot widen the scope by handing over the
 * wrong id, and the checkout does not pay for an extra round trip.
 */
export async function findBlockingSuppression(
  db: DbClient,
  input: { projectId: string; email: string; stream: EmailStream }
): Promise<BlockingSuppression | null> {
  const email = input.email.trim().toLowerCase();
  if (!email) return null;

  const orgWide = [...ORG_WIDE_SUPPRESSION_REASONS];

  const rows = await db
    .select({
      id: suppressions.id,
      email: suppressions.email,
      reason: suppressions.reason,
      projectId: suppressions.projectId,
      organizationId: suppressions.organizationId,
    })
    .from(suppressions)
    .where(
      and(
        eq(suppressions.email, email),
        or(
          // Same project: any reason applies, subject to the stream rule below.
          eq(suppressions.projectId, input.projectId),
          // Same organization: only the mailbox-fact reasons travel.
          and(
            inArray(suppressions.reason, orgWide),
            sql`${suppressions.organizationId} = (
              select ${projects.organizationId} from ${projects}
              where ${projects.id} = ${input.projectId}
            )`
          )
        )
      )
    )
    .limit(10);

  if (rows.length === 0) return null;

  // A project-local row is preferred over a cross-project one so the reason we
  // surface is the most specific explanation available.
  rows.sort(
    (a, b) => Number(a.projectId !== input.projectId) - Number(b.projectId !== input.projectId)
  );

  for (const row of rows) {
    if (!blocksStream(row.reason, input.stream)) continue;
    return {
      id: row.id,
      email: row.email,
      reason: row.reason,
      projectId: row.projectId,
      organizationId: row.organizationId,
      crossProject: row.projectId !== input.projectId,
      blocksAllStreams: !isMarketingOnlyReason(row.reason),
    };
  }
  return null;
}

/** Human-readable explanation for a refusal, naming the scope that matched. */
export function describeBlock(block: BlockingSuppression): string {
  const where = block.crossProject ? "another project in this workspace" : "this project";
  const what = block.blocksAllStreams ? "" : " for broadcast mail";
  return `Recipient is suppressed${what} (${block.reason}) in ${where}.`;
}
