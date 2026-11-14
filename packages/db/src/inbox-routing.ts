/**
 * Routing received mail into inboxes, and grouping it into conversations.
 *
 * Two decisions are made for every stored message, in this order:
 *
 *  1. **Which inbox?** An exact address rule (`support@inbox.acme.com`) wins over
 *     the domain's catch-all (`*@inbox.acme.com`). No rule means the message
 *     stays at project level with `inbox_id = NULL` — visible, searchable, and
 *     recoverable once someone adds a rule. Nothing is silently discarded.
 *  2. **Which conversation?** Header threading first (`In-Reply-To`, then
 *     `References`), because that is what the sender's mail client believes.
 *     Only when headers give nothing do we fall back to a derived thread key
 *     (participants + subject with `Re:`/`Fwd:` stripped), and only within a
 *     45-day window so an invoice thread from last year cannot absorb this
 *     year's invoice with the same subject.
 *
 * Both steps are pure enough to test and boring enough to trust: the only state
 * they mutate is counters on the conversation, recomputed rather than
 * incremented by guesswork where possible.
 */
import { createHash } from "node:crypto";
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import type { DbClient, DbExecutor } from "./client.js";
import { inboxConversations, inboxRoutes, inboxes } from "./schema/inboxes.js";
import { inboundMessages } from "./schema/inbound.js";

/** How far back subject-based threading may reach. */
export const THREAD_WINDOW_DAYS = 45;
export const THREAD_WINDOW_MS = THREAD_WINDOW_DAYS * 24 * 60 * 60 * 1000;

const REPLY_PREFIX = /^(?:\s*(?:re|fwd?|aw|sv|tr)\s*(?:\[\d+\])?\s*:\s*)+/i;

/** Subject without reply/forward prefixes, collapsed and lower-cased. */
export function normaliseSubject(subject: string | null | undefined): string {
  if (!subject) return "";
  let value = subject.replace(/\s+/g, " ").trim();
  // Strip repeatedly: "Re: FW: Re: Invoice" is still "invoice".
  let previous = "";
  while (previous !== value) {
    previous = value;
    value = value.replace(REPLY_PREFIX, "").trim();
  }
  return value.toLowerCase();
}

/**
 * Stable thread key from the participants and subject.
 *
 * Sorted participants make the key independent of who wrote first; the
 * normalised subject is what survives a mail client that rewrites Message-ID.
 * Truncated to 64 hex chars to fit the column.
 */
export function threadKeyFor(input: {
  participants: string[];
  subject: string | null | undefined;
}): string {
  const people = [...new Set(input.participants.map((p) => p.trim().toLowerCase()).filter(Boolean))]
    .sort()
    .join(",");
  const subject = normaliseSubject(input.subject);
  return createHash("sha256").update(`${subject}\u0000${people}`).digest("hex").slice(0, 64);
}

/** Local part of an address, lower-cased, or null. */
export function localPartOf(address: string | null | undefined): string | null {
  if (!address) return null;
  const at = address.lastIndexOf("@");
  if (at <= 0) return null;
  return address.slice(0, at).trim().toLowerCase();
}

/** Which inbox accepts this local part on this receiving domain, if any. */
export async function resolveInboxForRecipient(
  db: DbExecutor,
  input: { receivingDomainId: string; address: string | null }
): Promise<string | null> {
  const local = localPartOf(input.address);
  const candidates = local ? [local, "*"] : ["*"];
  const rows = await db
    .select({ inboxId: inboxRoutes.inboxId, localPart: inboxRoutes.localPart })
    .from(inboxRoutes)
    .where(
      and(
        eq(inboxRoutes.receivingDomainId, input.receivingDomainId),
        inArray(inboxRoutes.localPart, candidates)
      )
    );
  if (rows.length === 0) return null;
  // Exact address beats catch-all regardless of insertion order.
  const exact = rows.find((r) => r.localPart === local);
  return (exact ?? rows[0])?.inboxId ?? null;
}

/** Message-IDs from a References / In-Reply-To header, oldest first. */
export function parseMessageIds(...headers: Array<string | null | undefined>): string[] {
  const ids: string[] = [];
  for (const header of headers) {
    if (!header) continue;
    for (const match of header.matchAll(/<[^<>\s]+>/g)) {
      const id = match[0];
      if (!ids.includes(id)) ids.push(id);
    }
  }
  return ids;
}

export interface RouteInput {
  inboundMessageId: string;
  projectId: string;
  organizationId: string;
  receivingDomainId: string;
  envelopeRecipient: string | null;
  fromAddress: string | null;
  toAddresses: string[];
  subject: string | null;
  messageIdHeader: string | null;
  inReplyTo: string | null;
  references: string | null;
  receivedAt: Date;
}

export interface RouteResult {
  inboxId: string | null;
  conversationId: string | null;
  /** True when this message started a new conversation. */
  started: boolean;
}

/**
 * Route and thread one already-stored message.
 *
 * Runs inside the caller's transaction (ingest passes its `tx`), so a message
 * can never be `parsed` and unthreaded: either both the routing and the status
 * update land, or neither does.
 */
export async function routeInboundMessage(db: DbClient, input: RouteInput): Promise<RouteResult> {
  const inboxId = await resolveInboxForRecipient(db, {
    receivingDomainId: input.receivingDomainId,
    address: input.envelopeRecipient,
  });

  if (!inboxId) {
    return { inboxId: null, conversationId: null, started: false };
  }

  const participants = [input.fromAddress, ...input.toAddresses, input.envelopeRecipient].filter(
    (a): a is string => Boolean(a && a.length > 0)
  );

  // ── 1. Header threading ────────────────────────────────────────────────
  const headerIds = parseMessageIds(input.inReplyTo, input.references);
  let conversationId: string | null = null;
  if (headerIds.length > 0) {
    const [hit] = await db
      .select({ conversationId: inboundMessages.conversationId })
      .from(inboundMessages)
      .where(
        and(
          eq(inboundMessages.projectId, input.projectId),
          eq(inboundMessages.inboxId, inboxId),
          inArray(inboundMessages.messageIdHeader, headerIds),
          sql`${inboundMessages.conversationId} is not null`
        )
      )
      .orderBy(desc(inboundMessages.receivedAt))
      .limit(1);
    conversationId = hit?.conversationId ?? null;
  }

  // ── 2. Subject + participants, recent only ─────────────────────────────
  const threadKey = threadKeyFor({ participants, subject: input.subject });
  if (!conversationId) {
    const since = new Date(input.receivedAt.getTime() - THREAD_WINDOW_MS);
    const [hit] = await db
      .select({ id: inboxConversations.id })
      .from(inboxConversations)
      .where(
        and(
          eq(inboxConversations.inboxId, inboxId),
          eq(inboxConversations.threadKey, threadKey),
          gte(inboxConversations.lastMessageAt, since)
        )
      )
      .orderBy(desc(inboxConversations.lastMessageAt))
      .limit(1);
    conversationId = hit?.id ?? null;
  }

  // ── 3. New conversation ────────────────────────────────────────────────
  let started = false;
  if (!conversationId) {
    const [inbox] = await db
      .select({ organizationId: inboxes.organizationId, projectId: inboxes.projectId })
      .from(inboxes)
      .where(eq(inboxes.id, inboxId))
      .limit(1);
    if (!inbox) return { inboxId: null, conversationId: null, started: false };

    const id = `cnv_${input.inboundMessageId.replace(/^inb_/, "")}`;
    await db
      .insert(inboxConversations)
      .values({
        id,
        organizationId: inbox.organizationId,
        projectId: inbox.projectId,
        inboxId,
        subject: input.subject,
        threadKey,
        participants: [...new Set(participants.map((p) => p.toLowerCase()))],
        status: "open",
        firstMessageAt: input.receivedAt,
        lastMessageAt: input.receivedAt,
        messageCount: 0,
        inboundCount: 0,
      })
      // Deterministic id makes a retried ingest attach to the same row rather
      // than opening a duplicate conversation.
      .onConflictDoNothing({ target: inboxConversations.id });
    conversationId = id;
    started = true;
  }

  // Merge participants, bump counters, move lastMessageAt forward only.
  await db
    .update(inboxConversations)
    .set({
      lastMessageAt: sql`greatest(${inboxConversations.lastMessageAt}, ${input.receivedAt.toISOString()}::timestamptz)`,
      messageCount: sql`${inboxConversations.messageCount} + 1`,
      inboundCount: sql`${inboxConversations.inboundCount} + 1`,
      participants: sql`(
        select to_jsonb(array(
          select distinct value
          from jsonb_array_elements_text(
            ${inboxConversations.participants}::jsonb || ${JSON.stringify([
              ...new Set(participants.map((p) => p.toLowerCase())),
            ])}::jsonb
          ) as value
        ))
      )`,
      // A new inbound message on a closed conversation reopens it: the customer
      // wrote back, so pretending it is still closed would hide it from the team.
      status: sql`case when ${inboxConversations.status} = 'closed' then 'open'::conversation_status else ${inboxConversations.status} end`,
      closedAt: sql`case when ${inboxConversations.status} = 'closed' then null else ${inboxConversations.closedAt} end`,
      version: sql`${inboxConversations.version} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(inboxConversations.id, conversationId));

  await db
    .update(inboundMessages)
    .set({ inboxId, conversationId, status: "routed" })
    .where(eq(inboundMessages.id, input.inboundMessageId));

  return { inboxId, conversationId, started };
}
