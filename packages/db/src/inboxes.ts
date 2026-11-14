/**
 * Inbox queries and mutations (Stage 4).
 *
 * These are deliberately capability-free: every function takes ids that the
 * caller has already authorised, and the authorisation itself lives in one place
 * (`inboxCapabilities`). Splitting it this way means the database layer has no
 * opinion about who is asking — which is exactly what makes it reusable from the
 * dashboard and the API without a second copy of the rules — while the guards
 * that call it cannot drift, because there is only one of them.
 */
import { and, count, desc, eq, gte, inArray, isNull, lt, or, sql } from "drizzle-orm";
import type { DbClient, DbExecutor } from "./client.js";
import {
  inboxConversationLabels,
  inboxConversations,
  inboxLabels,
  inboxMembers,
  inboxNotes,
  inboxReplies,
  inboxRoutes,
  inboxes,
} from "./schema/inboxes.js";
import { inboundAttachments, inboundMessages, receivingDomains } from "./schema/inbound.js";
import { users } from "./schema/users.js";

export interface InboxSummary {
  id: string;
  name: string;
  slug: string;
  projectId: string;
  status: string;
  defaultSenderId: string | null;
  replyToAddress: string | null;
  routes: Array<{ address: string; domain: string; localPart: string }>;
  openConversations: number;
  lastMessageAt: Date | null;
}

/** Every inbox in a project, with the addresses that deliver to it. */
export async function listInboxesForProject(
  db: DbExecutor,
  projectId: string
): Promise<InboxSummary[]> {
  const rows = await db
    .select({
      id: inboxes.id,
      name: inboxes.name,
      slug: inboxes.slug,
      projectId: inboxes.projectId,
      status: inboxes.status,
      defaultSenderId: inboxes.defaultSenderId,
      replyToAddress: inboxes.replyToAddress,
    })
    .from(inboxes)
    .where(eq(inboxes.projectId, projectId))
    .orderBy(inboxes.name);

  if (rows.length === 0) return [];

  const routes = await db
    .select({
      inboxId: inboxRoutes.inboxId,
      localPart: inboxRoutes.localPart,
      domain: receivingDomains.domain,
    })
    .from(inboxRoutes)
    .innerJoin(receivingDomains, eq(receivingDomains.id, inboxRoutes.receivingDomainId))
    .where(
      inArray(
        inboxRoutes.inboxId,
        rows.map((r) => r.id)
      )
    );

  const counts = await db
    .select({
      inboxId: inboxConversations.inboxId,
      open: count(),
      last: sql<Date | null>`max(${inboxConversations.lastMessageAt})`,
    })
    .from(inboxConversations)
    .where(
      and(
        inArray(
          inboxConversations.inboxId,
          rows.map((r) => r.id)
        ),
        sql`${inboxConversations.status} <> 'closed'`
      )
    )
    .groupBy(inboxConversations.inboxId);

  const countByInbox = new Map(counts.map((c) => [c.inboxId, c]));
  return rows.map((row) => {
    const own = routes.filter((r) => r.inboxId === row.id);
    return {
      ...row,
      routes: own.map((r) => ({
        localPart: r.localPart,
        domain: r.domain,
        address: r.localPart === "*" ? `*@${r.domain}` : `${r.localPart}@${r.domain}`,
      })),
      openConversations: Number(countByInbox.get(row.id)?.open ?? 0),
      lastMessageAt: countByInbox.get(row.id)?.last ?? null,
    };
  });
}

/** Inboxes this user may act in, given their explicit memberships. */
export async function inboxRolesForUser(
  db: DbExecutor,
  userId: string,
  inboxIds: string[]
): Promise<Map<string, "viewer" | "member" | "manager">> {
  if (inboxIds.length === 0) return new Map();
  const rows = await db
    .select({ inboxId: inboxMembers.inboxId, role: inboxMembers.role })
    .from(inboxMembers)
    .where(and(eq(inboxMembers.userId, userId), inArray(inboxMembers.inboxId, inboxIds)));
  return new Map(rows.map((r) => [r.inboxId, r.role as "viewer" | "member" | "manager"]));
}

export interface ConversationListFilters {
  inboxId: string;
  status?: "open" | "pending" | "closed" | "all";
  assigneeUserId?: string | null;
  labelId?: string;
  /** Substring/full-text search across subject, participants and message bodies. */
  q?: string;
  limit?: number;
  cursor?: { lastMessageAt: Date; id: string };
}

export interface ConversationListRow {
  id: string;
  subject: string | null;
  status: string;
  participants: string[];
  assigneeUserId: string | null;
  assigneeName: string | null;
  lastMessageAt: Date;
  messageCount: number;
  labels: string[];
}

export async function listConversations(
  db: DbExecutor,
  filters: ConversationListFilters
): Promise<{ rows: ConversationListRow[]; nextCursor: string | null }> {
  const limit = Math.min(Math.max(filters.limit ?? 30, 1), 100);
  const conditions = [eq(inboxConversations.inboxId, filters.inboxId)];

  if (!filters.status || filters.status === "all") {
    // everything
  } else {
    conditions.push(eq(inboxConversations.status, filters.status));
  }
  if (filters.assigneeUserId !== undefined) {
    conditions.push(
      filters.assigneeUserId === null
        ? isNull(inboxConversations.assigneeUserId)
        : eq(inboxConversations.assigneeUserId, filters.assigneeUserId)
    );
  }
  if (filters.cursor) {
    const keyset = or(
      lt(inboxConversations.lastMessageAt, filters.cursor.lastMessageAt),
      and(
        eq(inboxConversations.lastMessageAt, filters.cursor.lastMessageAt),
        lt(inboxConversations.id, filters.cursor.id)
      )
    );
    if (keyset) conditions.push(keyset);
  }
  if (filters.q) {
    const needle = `%${filters.q}%`;
    const search = or(
      sql`coalesce(${inboxConversations.subject}, '') ilike ${needle}`,
      sql`${inboxConversations.participants}::text ilike ${needle}`,
      sql`exists (
        select 1 from ${inboundMessages}
         where ${inboundMessages.conversationId} = ${inboxConversations.id}
           and to_tsvector('simple', coalesce(${inboundMessages.subject}, '') || ' ' || coalesce(${inboundMessages.bodyText}, '') || ' ' || coalesce(${inboundMessages.fromAddress}, ''))
               @@ websearch_to_tsquery('simple', ${filters.q})
      )`
    );
    if (search) conditions.push(search);
  }

  const rows = await db
    .select({
      id: inboxConversations.id,
      subject: inboxConversations.subject,
      status: inboxConversations.status,
      participants: inboxConversations.participants,
      assigneeUserId: inboxConversations.assigneeUserId,
      assigneeName: users.name,
      lastMessageAt: inboxConversations.lastMessageAt,
      messageCount: inboxConversations.messageCount,
    })
    .from(inboxConversations)
    .leftJoin(users, eq(users.id, inboxConversations.assigneeUserId))
    .where(and(...conditions))
    .orderBy(desc(inboxConversations.lastMessageAt), desc(inboxConversations.id))
    .limit(limit + 1);

  const page = rows.slice(0, limit);

  // Labels per conversation, one query for the page.
  let labelMap = new Map<string, string[]>();
  if (page.length > 0) {
    const labelRows = await db
      .select({ conversationId: inboxConversationLabels.conversationId, name: inboxLabels.name })
      .from(inboxConversationLabels)
      .innerJoin(inboxLabels, eq(inboxLabels.id, inboxConversationLabels.labelId))
      .where(
        inArray(
          inboxConversationLabels.conversationId,
          page.map((r) => r.id)
        )
      );
    labelMap = labelRows.reduce((acc, row) => {
      const list = acc.get(row.conversationId) ?? [];
      list.push(row.name);
      acc.set(row.conversationId, list);
      return acc;
    }, new Map<string, string[]>());
  }

  if (filters.labelId) {
    // Filtered in SQL would need a join above; do it here so the shape stays one
    // query for the page rather than one per row.
    const allowed = await db
      .select({ conversationId: inboxConversationLabels.conversationId })
      .from(inboxConversationLabels)
      .where(
        and(
          eq(inboxConversationLabels.labelId, filters.labelId),
          inArray(
            inboxConversationLabels.conversationId,
            page.map((r) => r.id)
          )
        )
      );
    const ids = new Set(allowed.map((a) => a.conversationId));
    const filtered = page.filter((row) => ids.has(row.id));
    const last = filtered[filtered.length - 1];
    return {
      rows: filtered.map((row) => ({ ...row, labels: labelMap.get(row.id) ?? [] })),
      nextCursor: last ? `${last.lastMessageAt.toISOString()}|${last.id}` : null,
    };
  }

  const last = page[page.length - 1];
  return {
    rows: page.map((row) => ({ ...row, labels: labelMap.get(row.id) ?? [] })),
    nextCursor:
      rows.length > limit && last ? `${last.lastMessageAt.toISOString()}|${last.id}` : null,
  };
}

export interface ConversationMessage {
  kind: "inbound" | "reply";
  id: string;
  at: Date;
  fromAddress: string | null;
  fromName: string | null;
  toAddresses: string[];
  subject: string | null;
  bodyText: string | null;
  bodyHtml: string | null;
  authorUserId: string | null;
  emailId: string | null;
  attachments: Array<{
    id: string;
    filename: string | null;
    contentType: string | null;
    sizeBytes: number;
    stored: boolean;
  }>;
}

export interface ConversationDetail {
  id: string;
  inboxId: string;
  projectId: string;
  subject: string | null;
  status: string;
  assigneeUserId: string | null;
  participants: string[];
  lastMessageAt: Date;
  labels: Array<{ id: string; name: string }>;
  messages: ConversationMessage[];
  notes: Array<{
    id: string;
    authorUserId: string | null;
    authorName: string | null;
    body: string;
    createdAt: Date;
  }>;
}

/**
 * One conversation with its whole thread: inbound messages, replies sent from
 * here, and internal notes — merged into a single chronological list so the UI
 * cannot accidentally show a reply out of order with the message it answers.
 */
export async function getConversation(
  db: DbExecutor,
  input: { conversationId: string }
): Promise<ConversationDetail | null> {
  const [conversation] = await db
    .select()
    .from(inboxConversations)
    .where(eq(inboxConversations.id, input.conversationId))
    .limit(1);
  if (!conversation) return null;

  const [inbound, replies, notes, labelRows] = await Promise.all([
    db
      .select({
        id: inboundMessages.id,
        receivedAt: inboundMessages.receivedAt,
        fromAddress: inboundMessages.fromAddress,
        fromName: inboundMessages.fromName,
        toAddresses: inboundMessages.toAddresses,
        subject: inboundMessages.subject,
        bodyText: inboundMessages.bodyText,
        bodyHtml: inboundMessages.bodyHtml,
        status: inboundMessages.status,
        failureReason: inboundMessages.failureReason,
      })
      .from(inboundMessages)
      .where(eq(inboundMessages.conversationId, conversation.id))
      .orderBy(inboundMessages.receivedAt),
    db
      .select({
        id: inboxReplies.id,
        emailId: inboxReplies.emailId,
        senderId: inboxReplies.senderId,
        authorUserId: inboxReplies.authorUserId,
        bodyText: inboxReplies.bodyText,
        bodyHtml: inboxReplies.bodyHtml,
        createdAt: inboxReplies.createdAt,
      })
      .from(inboxReplies)
      .where(eq(inboxReplies.conversationId, conversation.id))
      .orderBy(inboxReplies.createdAt),
    db
      .select({
        id: inboxNotes.id,
        authorUserId: inboxNotes.authorUserId,
        authorName: users.name,
        body: inboxNotes.body,
        createdAt: inboxNotes.createdAt,
      })
      .from(inboxNotes)
      .leftJoin(users, eq(users.id, inboxNotes.authorUserId))
      .where(eq(inboxNotes.conversationId, conversation.id))
      .orderBy(inboxNotes.createdAt),
    db
      .select({ id: inboxLabels.id, name: inboxLabels.name })
      .from(inboxConversationLabels)
      .innerJoin(inboxLabels, eq(inboxLabels.id, inboxConversationLabels.labelId))
      .where(eq(inboxConversationLabels.conversationId, conversation.id)),
  ]);

  const attachmentsByMessage = new Map<string, ConversationMessage["attachments"]>();
  if (inbound.length > 0) {
    const rows = await db
      .select({
        id: inboundAttachments.id,
        inboundMessageId: inboundAttachments.inboundMessageId,
        filename: inboundAttachments.filename,
        contentType: inboundAttachments.contentType,
        sizeBytes: inboundAttachments.sizeBytes,
        storageKey: inboundAttachments.storageKey,
      })
      .from(inboundAttachments)
      .where(
        inArray(
          inboundAttachments.inboundMessageId,
          inbound.map((m) => m.id)
        )
      );
    for (const row of rows) {
      const list = attachmentsByMessage.get(row.inboundMessageId) ?? [];
      list.push({
        id: row.id,
        filename: row.filename,
        contentType: row.contentType,
        sizeBytes: row.sizeBytes,
        stored: Boolean(row.storageKey),
      });
      attachmentsByMessage.set(row.inboundMessageId, list);
    }
  }

  const messages: ConversationMessage[] = [
    ...inbound.map((m) => ({
      kind: "inbound" as const,
      id: m.id,
      at: m.receivedAt,
      fromAddress: m.fromAddress,
      fromName: m.fromName,
      toAddresses: m.toAddresses,
      subject: m.subject,
      bodyText: m.bodyText,
      bodyHtml: m.bodyHtml,
      authorUserId: null,
      emailId: null,
      attachments: attachmentsByMessage.get(m.id) ?? [],
    })),
    ...replies.map((r) => ({
      kind: "reply" as const,
      id: r.id,
      at: r.createdAt,
      fromAddress: null,
      fromName: null,
      toAddresses: [] as string[],
      subject: null,
      bodyText: r.bodyText,
      bodyHtml: r.bodyHtml,
      authorUserId: r.authorUserId,
      emailId: r.emailId,
      attachments: [] as ConversationMessage["attachments"],
    })),
  ].sort((a, b) => a.at.getTime() - b.at.getTime());

  return {
    id: conversation.id,
    inboxId: conversation.inboxId,
    projectId: conversation.projectId,
    subject: conversation.subject,
    status: conversation.status,
    assigneeUserId: conversation.assigneeUserId,
    participants: conversation.participants,
    lastMessageAt: conversation.lastMessageAt,
    labels: labelRows,
    messages,
    notes,
  };
}

/** Users who may be assigned: everyone with an inbox row, plus org owners/admins. */
export async function inboxAssignableMembers(
  db: DbExecutor,
  inboxId: string
): Promise<Array<{ userId: string; name: string | null; email: string; role: string }>> {
  const rows = await db
    .select({
      userId: inboxMembers.userId,
      role: inboxMembers.role,
      name: users.name,
      email: users.email,
    })
    .from(inboxMembers)
    .innerJoin(users, eq(users.id, inboxMembers.userId))
    .where(eq(inboxMembers.inboxId, inboxId))
    .orderBy(users.name);
  return rows;
}

export interface ConversationPatch {
  status?: "open" | "pending" | "closed";
  assigneeUserId?: string | null;
}

/**
 * Apply a status/assignee change with optimistic concurrency.
 *
 * `expectedVersion` comes from the rendered page, so two agents closing and
 * reopening the same conversation do not silently overwrite each other — the
 * second one gets `null` and the UI can say "someone else changed this".
 */
export async function updateConversation(
  db: DbExecutor,
  input: { conversationId: string; patch: ConversationPatch; expectedVersion?: number }
): Promise<{ version: number } | null> {
  const now = new Date();
  const conditions = [eq(inboxConversations.id, input.conversationId)];
  if (typeof input.expectedVersion === "number") {
    conditions.push(eq(inboxConversations.version, input.expectedVersion));
  }

  const updated = await db
    .update(inboxConversations)
    .set({
      ...(input.patch.status ? { status: input.patch.status } : {}),
      ...(input.patch.status === "closed" ? { closedAt: now } : {}),
      ...(input.patch.status && input.patch.status !== "closed" ? { closedAt: null } : {}),
      ...(input.patch.assigneeUserId !== undefined
        ? { assigneeUserId: input.patch.assigneeUserId }
        : {}),
      version: sql`${inboxConversations.version} + 1`,
      updatedAt: now,
    })
    .where(and(...conditions))
    .returning({ version: inboxConversations.version });

  return updated[0] ?? null;
}

export async function addConversationNote(
  db: DbExecutor,
  input: { id: string; conversationId: string; authorUserId: string; body: string }
): Promise<void> {
  await db.insert(inboxNotes).values({
    id: input.id,
    conversationId: input.conversationId,
    authorUserId: input.authorUserId,
    body: input.body.slice(0, 20_000),
  });
}

/** Record a sent reply in the conversation and bump its counters. */
export async function recordConversationReply(
  db: DbExecutor,
  input: {
    id: string;
    conversationId: string;
    emailId: string;
    senderId: string | null;
    authorUserId: string;
    bodyText: string | null;
    bodyHtml: string | null;
    at?: Date;
  }
): Promise<void> {
  const at = input.at ?? new Date();
  await db.insert(inboxReplies).values({
    id: input.id,
    conversationId: input.conversationId,
    emailId: input.emailId,
    senderId: input.senderId,
    authorUserId: input.authorUserId,
    bodyText: input.bodyText,
    bodyHtml: input.bodyHtml,
    createdAt: at,
  });
  await db
    .update(inboxConversations)
    .set({
      replyCount: sql`${inboxConversations.replyCount} + 1`,
      messageCount: sql`${inboxConversations.messageCount} + 1`,
      lastMessageAt: sql`greatest(${inboxConversations.lastMessageAt}, ${at.toISOString()}::timestamptz)`,
      // Answering puts a conversation back in the open queue rather than closed.
      status: sql`case when ${inboxConversations.status} = 'closed' then 'open'::conversation_status else ${inboxConversations.status} end`,
      closedAt: sql`case when ${inboxConversations.status} = 'closed' then null else ${inboxConversations.closedAt} end`,
      version: sql`${inboxConversations.version} + 1`,
      updatedAt: at,
    })
    .where(eq(inboxConversations.id, input.conversationId));
}

export async function setConversationLabels(
  db: DbExecutor,
  input: { conversationId: string; labelIds: string[] }
): Promise<void> {
  await db
    .delete(inboxConversationLabels)
    .where(eq(inboxConversationLabels.conversationId, input.conversationId));
  if (input.labelIds.length === 0) return;
  await db
    .insert(inboxConversationLabels)
    .values(input.labelIds.map((labelId) => ({ conversationId: input.conversationId, labelId })))
    .onConflictDoNothing();
}

export async function listLabels(db: DbExecutor, projectId: string) {
  return db
    .select()
    .from(inboxLabels)
    .where(eq(inboxLabels.projectId, projectId))
    .orderBy(inboxLabels.name);
}

/** Mark the inbox read for one member (unread badge only). */
export async function markInboxRead(
  db: DbExecutor,
  input: { inboxId: string; userId: string; at?: Date }
): Promise<void> {
  await db
    .update(inboxMembers)
    .set({ lastReadAt: input.at ?? new Date() })
    .where(and(eq(inboxMembers.inboxId, input.inboxId), eq(inboxMembers.userId, input.userId)));
}

/** Conversations with new inbound mail since this member last read the inbox. */
export async function unreadCount(
  db: DbExecutor,
  input: { inboxId: string; userId: string }
): Promise<number> {
  const [membership] = await db
    .select({ lastReadAt: inboxMembers.lastReadAt })
    .from(inboxMembers)
    .where(and(eq(inboxMembers.inboxId, input.inboxId), eq(inboxMembers.userId, input.userId)))
    .limit(1);
  const since = membership?.lastReadAt;
  const [row] = await db
    .select({ value: count() })
    .from(inboxConversations)
    .where(
      and(
        eq(inboxConversations.inboxId, input.inboxId),
        since ? gte(inboxConversations.lastMessageAt, since) : sql`true`
      )
    );
  return Number(row?.value ?? 0);
}
