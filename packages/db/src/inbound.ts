/**
 * Inbound data layer (Stage 3).
 *
 * Three rules encoded here, all of them about keeping receiving from
 * contaminating sending:
 *
 *  1. **The inbound meter is a different metric.** Quota counts
 *     `inbound_messages` rows; the ledger writes `METRIC_INBOUND_EMAILS`. No
 *     query in the outbound path ever sums that metric, so 500 received
 *     messages cannot change a 10,000-message outbound allowance. This is
 *     enforced by construction, not by a comment.
 *  2. **Metering is idempotent.** The ledger id is derived from the inbound
 *     message id (`ur_inb_<id>`) and written with ON CONFLICT DO NOTHING, so an
 *     SNS redelivery, a retry after a transient failure, or two concurrent
 *     deliveries of the same SES message all converge on one unit.
 *  3. **A refused message is visible.** When a workspace is out of inbound
 *     allowance we do not store the body, but we do keep a small `rejected`
 *     row: silence would be indistinguishable from "nothing was sent".
 */
import { and, count, desc, eq, gte, ilike, inArray, lt, or, sql } from "drizzle-orm";
import {
  checkInboundAllowance,
  METRIC_INBOUND_EMAILS,
  planInboundEmailsLimit,
  planFor,
  type InboundAllowanceDecision,
  type UsagePeriod,
} from "@calder/config";
import type { DbClient, DbExecutor } from "./client.js";
import { inboundAttachments, inboundMessages, receivingDomains } from "./schema/inbound.js";
import { usageRecords } from "./schema/billing.js";
import { orgUsagePeriod, resolveOrgTier } from "./usage.js";

/** Counted apart from `rejected`: a message we refused is not a message we took. */
export async function orgInboundReceivedInPeriod(
  db: DbExecutor,
  organizationId: string,
  period: UsagePeriod
): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(inboundMessages)
    .where(
      and(
        eq(inboundMessages.organizationId, organizationId),
        gte(inboundMessages.receivedAt, period.start),
        lt(inboundMessages.receivedAt, period.end),
        inArray(inboundMessages.status, ["received", "parsed", "routed", "failed"])
      )
    );
  return Number(row?.value ?? 0);
}

export interface InboundUsage {
  tier: string;
  limit: number | null;
  received: number;
  period: UsagePeriod;
}

export async function organizationInboundUsage(
  db: DbExecutor,
  organizationId: string,
  now: Date = new Date()
): Promise<InboundUsage> {
  const period = await orgUsagePeriod(db, organizationId, now);
  const [tier, received] = await Promise.all([
    resolveOrgTier(db, organizationId),
    orgInboundReceivedInPeriod(db, organizationId, period),
  ]);
  return { tier, limit: planInboundEmailsLimit(tier), received, period };
}

/**
 * May this organisation accept one more message right now?
 *
 * Called once per delivery, immediately before the message row is written, so
 * the count and the write are as close together as this layer can make them.
 */
export async function checkInboundQuota(
  db: DbExecutor,
  organizationId: string,
  now: Date = new Date(),
  /**
   * Rows already counted that should not count *against themselves*. Ingest
   * claims the message row before asking (that is what makes redelivery a
   * no-op), so the message being admitted is in the count: without this, the
   * 500th message of a 500 allowance would be refused for being over 500.
   */
  alreadyCounted = 0
): Promise<InboundAllowanceDecision & { received: number; limit: number | null }> {
  const usage = await organizationInboundUsage(db, organizationId, now);
  const effective = Math.max(0, usage.received - alreadyCounted);
  const decision = checkInboundAllowance(usage.tier, effective);
  return { ...decision, received: effective, limit: usage.limit };
}

/**
 * Record one received message on the inbound ledger. Idempotent by message id.
 * Returns true when this call inserted the unit (i.e. it was not already there).
 */
export async function recordInboundUsage(
  db: DbExecutor,
  input: {
    organizationId: string;
    projectId: string;
    inboundMessageId: string;
    period: UsagePeriod;
  }
): Promise<boolean> {
  const inserted = await db
    .insert(usageRecords)
    .values({
      id: `ur_inb_${input.inboundMessageId}`,
      organizationId: input.organizationId,
      projectId: input.projectId,
      metric: METRIC_INBOUND_EMAILS,
      quantity: 1,
      periodStart: input.period.start,
      periodEnd: input.period.end,
    })
    .onConflictDoNothing({ target: usageRecords.id })
    .returning({ id: usageRecords.id });
  return inserted.length > 0;
}

/** Stored bytes for an organisation — the metered (not capped) storage dimension. */
export async function organizationInboundStorage(
  db: DbExecutor,
  organizationId: string
): Promise<{ messages: number; attachments: number; bytes: number }> {
  const [messageRow] = await db
    .select({
      messages: count(),
      bytes: sql<number>`coalesce(sum(${inboundMessages.sizeBytes}), 0)`,
    })
    .from(inboundMessages)
    .where(eq(inboundMessages.organizationId, organizationId));

  const [attachmentRow] = await db
    .select({
      attachments: count(),
      bytes: sql<number>`coalesce(sum(${inboundAttachments.sizeBytes}), 0)`,
    })
    .from(inboundAttachments)
    .innerJoin(inboundMessages, eq(inboundMessages.id, inboundAttachments.inboundMessageId))
    .where(eq(inboundMessages.organizationId, organizationId));

  const messageBytes = Number(messageRow?.bytes ?? 0);
  const attachmentBytes = Number(attachmentRow?.bytes ?? 0);
  return {
    messages: Number(messageRow?.messages ?? 0),
    attachments: Number(attachmentRow?.attachments ?? 0),
    bytes: messageBytes + attachmentBytes,
  };
}

export interface InboundListFilters {
  projectId: string;
  /** Full-text query over subject, sender and text body. */
  q?: string;
  recipient?: string;
  since?: Date;
  until?: Date;
  limit?: number;
  /** Cursor: `receivedAt|id` of the last row of the previous page. */
  cursor?: { receivedAt: Date; id: string };
}

export interface InboundListRow {
  id: string;
  receivedAt: Date;
  status: string;
  fromAddress: string | null;
  fromName: string | null;
  toAddresses: string[];
  subject: string | null;
  recipientDomain: string;
  sizeBytes: number;
  attachmentCount: number;
  spamVerdict: string | null;
  virusVerdict: string | null;
}

/**
 * Search and paginate one project's received mail.
 *
 * Descending (receivedAt, id) with a keyset cursor rather than OFFSET: mail
 * arrives while the user pages, and OFFSET would silently skip or repeat rows.
 */
export async function listInboundMessages(
  db: DbExecutor,
  filters: InboundListFilters
): Promise<{ rows: InboundListRow[]; nextCursor: string | null }> {
  const limit = Math.min(Math.max(filters.limit ?? 25, 1), 100);
  const conditions = [eq(inboundMessages.projectId, filters.projectId)];

  if (filters.recipient) {
    conditions.push(ilike(inboundMessages.envelopeRecipient, `%${filters.recipient}%`));
  }
  if (filters.since) conditions.push(gte(inboundMessages.receivedAt, filters.since));
  if (filters.until) conditions.push(lt(inboundMessages.receivedAt, filters.until));
  if (filters.cursor) {
    const keyset = or(
      lt(inboundMessages.receivedAt, filters.cursor.receivedAt),
      and(
        eq(inboundMessages.receivedAt, filters.cursor.receivedAt),
        lt(inboundMessages.id, filters.cursor.id)
      )
    );
    if (keyset) conditions.push(keyset);
  }
  if (filters.q) {
    // `websearch_to_tsquery` accepts what a person actually types ("invoice
    // from:acme", quoted phrases) and never throws on punctuation, unlike
    // `to_tsquery`.
    conditions.push(
      sql`to_tsvector('simple', coalesce(${inboundMessages.subject}, '') || ' ' || coalesce(${inboundMessages.bodyText}, '') || ' ' || coalesce(${inboundMessages.fromAddress}, '')) @@ websearch_to_tsquery('simple', ${filters.q})`
    );
  }

  const rows = await db
    .select({
      id: inboundMessages.id,
      receivedAt: inboundMessages.receivedAt,
      status: inboundMessages.status,
      fromAddress: inboundMessages.fromAddress,
      fromName: inboundMessages.fromName,
      toAddresses: inboundMessages.toAddresses,
      subject: inboundMessages.subject,
      recipientDomain: inboundMessages.recipientDomain,
      sizeBytes: inboundMessages.sizeBytes,
      attachmentCount: inboundMessages.attachmentCount,
      spamVerdict: inboundMessages.spamVerdict,
      virusVerdict: inboundMessages.virusVerdict,
    })
    .from(inboundMessages)
    .where(and(...conditions))
    .orderBy(desc(inboundMessages.receivedAt), desc(inboundMessages.id))
    .limit(limit + 1);

  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return {
    rows: page,
    nextCursor: rows.length > limit && last ? `${last.receivedAt.toISOString()}|${last.id}` : null,
  };
}

/** The receiving domain that owns a recipient address, for routing decisions. */
export async function findReceivingDomainByDomain(
  db: DbExecutor,
  domain: string
): Promise<{
  id: string;
  projectId: string;
  status: string;
  disabledAt: Date | null;
} | null> {
  const [row] = await db
    .select({
      id: receivingDomains.id,
      projectId: receivingDomains.projectId,
      status: receivingDomains.status,
      disabledAt: receivingDomains.disabledAt,
    })
    .from(receivingDomains)
    .where(eq(receivingDomains.domain, domain))
    .limit(1);
  return row ?? null;
}

/**
 * Whether a domain may receive right now.
 *
 * Both halves matter: DNS proof (`verified`) says the customer owns the
 * domain, and a provisioned SES receipt rule says AWS will actually deliver to
 * us. Accepting mail on an unverified claim would let anyone point MX at us
 * and have us store another organisation's mail.
 */
export function receivingDomainAccepts(domain: {
  status: string;
  disabledAt: Date | null;
  provisionedAt: Date | null;
}): { ok: true } | { ok: false; reason: string } {
  if (domain.disabledAt) return { ok: false, reason: "receiving domain is disabled" };
  if (domain.status !== "verified")
    return { ok: false, reason: `receiving domain is ${domain.status}, not verified` };
  if (!domain.provisionedAt)
    return { ok: false, reason: "no SES receipt rule has been provisioned for this domain" };
  return { ok: true };
}

export function planInboundStorageMb(tier: string | null | undefined): number | null {
  return planFor(tier).inboundStorageMb;
}
