"use server";

import { revalidatePath } from "next/cache";
import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import {
  addConversationNote,
  getConversation,
  getDb,
  inboxAssignableMembers,
  inboxes,
  inboxMembers,
  inboxConversations,
  inboxLabels,
  inboxRoutes,
  markInboxRead,
  receivingDomains,
  recordConversationReply,
  senderIdentities,
  setConversationLabels,
  updateConversation,
  users,
} from "@calder/db";
import { sendTransactional } from "../../../lib/send/transactional";
import {
  InboxAccessError,
  requireInboxCapability,
  resolveInboxAccess,
} from "../../../lib/inbox/guard";

/**
 * Inbox server actions.
 *
 * The conversation id is never trusted: every action loads the conversation,
 * derives the inbox from it, and asks `requireInboxCapability` for the specific
 * right it needs. A viewer who crafts a request to `reply` gets an error, not a
 * message sent under the workspace's name.
 */

const rid = (prefix: string) => `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 22)}`;

async function loadConversation(conversationId: string) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(inboxConversations)
    .where(eq(inboxConversations.id, conversationId))
    .limit(1);
  if (!row) throw new InboxAccessError("Conversation not found.");
  return row;
}

/** Assign/unassign, and change status (open / pending / closed). */
export async function setConversationState(
  conversationId: string,
  patch: {
    status?: "open" | "pending" | "closed";
    assigneeUserId?: string | null;
    expectedVersion?: number;
  }
) {
  const conversation = await loadConversation(conversationId);
  const access = await requireInboxCapability(
    conversation.inboxId,
    patch.assigneeUserId !== undefined && !patch.status ? "assign" : "triage"
  );

  if (patch.assigneeUserId) {
    // An assignee must be someone who can actually see this inbox; assigning to
    // a stranger would create a notification nobody can act on.
    const db = getDb();
    const [member] = await db
      .select({ userId: inboxMembers.userId })
      .from(inboxMembers)
      .where(
        and(
          eq(inboxMembers.inboxId, conversation.inboxId),
          eq(inboxMembers.userId, patch.assigneeUserId)
        )
      )
      .limit(1);
    const isOrgManager = access.organizationRole === "owner" || access.organizationRole === "admin";
    if (!member && !isOrgManager) throw new Error("That person is not a member of this inbox.");
  }

  const result = await updateConversation(getDb(), {
    conversationId,
    patch: {
      ...(patch.status ? { status: patch.status } : {}),
      ...(patch.assigneeUserId !== undefined ? { assigneeUserId: patch.assigneeUserId } : {}),
    },
    expectedVersion: patch.expectedVersion,
  });
  if (!result) {
    throw new Error("Someone else changed this conversation. Reload and try again.");
  }

  revalidatePath(`/inbox/${conversationId}`);
  revalidatePath("/inbox");
  return result;
}

/** Add an internal note. Never sent, never visible to the customer. */
export async function addNote(conversationId: string, body: string) {
  const conversation = await loadConversation(conversationId);
  const access = await requireInboxCapability(conversation.inboxId, "note");
  const text = body.trim();
  if (text.length === 0) throw new Error("Write something first.");
  if (text.length > 20_000) throw new Error("Notes are limited to 20,000 characters.");

  await addConversationNote(getDb(), {
    id: rid("note"),
    conversationId,
    authorUserId: access.userId,
    body: text,
  });
  revalidatePath(`/inbox/${conversationId}`);
  return { ok: true as const };
}

/**
 * Reply to the customer.
 *
 * The reply is a normal outbound email: it goes through `sendTransactional`,
 * which means sender verification, suppression checks, plan quota, metering and
 * webhooks all apply exactly as they do to any other send. This action only adds
 * the conversation link — there is deliberately no second send path.
 */
export async function replyToConversation(conversationId: string, body: string) {
  const conversation = await loadConversation(conversationId);
  const access = await requireInboxCapability(conversation.inboxId, "reply");

  const detail = await getConversation(getDb(), { conversationId });
  if (!detail) throw new Error("Conversation not found.");

  const text = body.trim();
  if (text.length === 0) throw new Error("Write a reply first.");

  const db = getDb();
  const [inbox] = await db
    .select()
    .from(inboxes)
    .where(eq(inboxes.id, conversation.inboxId))
    .limit(1);
  if (!inbox) throw new Error("Inbox not found.");

  const senderId = inbox.defaultSenderId;
  if (!senderId) {
    throw new Error(
      "This inbox has no default sender identity, so it cannot reply yet. Set one in the inbox settings — replies are always sent from a verified identity."
    );
  }
  const [sender] = await db
    .select()
    .from(senderIdentities)
    .where(and(eq(senderIdentities.id, senderId), eq(senderIdentities.projectId, inbox.projectId)))
    .limit(1);
  if (!sender) throw new Error("The inbox's sender identity no longer exists.");
  if (sender.status !== "verified" && sender.status !== "connected") {
    throw new Error(`${sender.email} is not verified, so it cannot send replies.`);
  }

  // Reply to the last inbound sender, not to ourselves.
  const lastInbound = [...detail.messages].reverse().find((m) => m.kind === "inbound");
  const recipient = lastInbound?.fromAddress;
  if (!recipient) throw new Error("There is no inbound sender to reply to.");

  const subject = replySubject(detail.subject);
  const sent = await sendTransactional({
    projectId: inbox.projectId,
    senderId,
    to: recipient,
    subject,
    text,
    html: textToHtml(text),
    replyTo: inbox.replyToAddress ?? undefined,
    metadata: { inbox_id: inbox.id, conversation_id: conversationId, sent_by: access.userId },
  });

  await recordConversationReply(db, {
    id: rid("rpl"),
    conversationId,
    emailId: sent.id,
    senderId,
    authorUserId: access.userId,
    bodyText: text,
    bodyHtml: textToHtml(text),
  });

  revalidatePath(`/inbox/${conversationId}`);
  revalidatePath("/inbox");
  return { ok: true as const, emailId: sent.id };
}

export async function setLabels(conversationId: string, labelIds: string[]) {
  const conversation = await loadConversation(conversationId);
  await requireInboxCapability(conversation.inboxId, "triage");
  const db = getDb();

  // Only labels from this project may be attached.
  const valid = labelIds.length
    ? await db
        .select({ id: inboxLabels.id })
        .from(inboxLabels)
        .where(
          and(eq(inboxLabels.projectId, conversation.projectId), inArray(inboxLabels.id, labelIds))
        )
    : [];
  await setConversationLabels(db, {
    conversationId,
    labelIds: valid.map((v) => v.id),
  });
  revalidatePath(`/inbox/${conversationId}`);
  return { ok: true as const };
}

export async function markRead(inboxId: string) {
  const access = await resolveInboxAccess(inboxId);
  await markInboxRead(getDb(), { inboxId, userId: access.userId });
  revalidatePath("/inbox");
  return { ok: true as const };
}

/* ── Inbox management ────────────────────────────────────────────────────── */

/**
 * Create an inbox inside a project.
 *
 * Gated on the *organisation* role (owner/admin) because it is a new resource,
 * not a change to one: there is no inbox membership to consult yet. The first
 * route is created with it, since an inbox that no address delivers to would be
 * a confusing empty shell.
 */
export async function createProjectInbox(input: {
  projectId: string;
  name: string;
  receivingDomainId: string;
  localPart: string;
  defaultSenderId?: string | null;
}) {
  const { assertProjectManager } = await import("../onboarding/actions");
  await assertProjectManager(input.projectId);

  const db = getDb();
  const name = input.name.trim().slice(0, 120);
  if (name.length < 2) throw new Error("Give the inbox a name (2+ characters).");

  const [domain] = await db
    .select()
    .from(receivingDomains)
    .where(eq(receivingDomains.id, input.receivingDomainId))
    .limit(1);
  if (!domain || domain.projectId !== input.projectId) {
    throw new Error("Choose a receiving domain from this project.");
  }

  const projectId = input.projectId;
  const [organization] = await db
    .select({ id: inboxes.organizationId })
    .from(inboxes)
    .where(eq(inboxes.projectId, projectId))
    .limit(1);
  const { organizationForProject } = await import("@calder/db");
  const organizationId = organization?.id ?? (await organizationForProject(db, projectId));
  if (!organizationId) throw new Error("Project not found.");

  const localPart = input.localPart.trim().toLowerCase() || "*";
  if (!/^(\*|[a-z0-9][a-z0-9._-]{0,63})$/.test(localPart)) {
    throw new Error(
      "Addresses may use letters, digits, dots, dashes and underscores — or * for catch-all."
    );
  }

  const baseSlug =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "inbox";
  const inboxId = rid("inbx");
  const existingSlugs = await db
    .select({ slug: inboxes.slug })
    .from(inboxes)
    .where(eq(inboxes.projectId, projectId));
  const taken = new Set(existingSlugs.map((r) => r.slug));
  let slug = baseSlug;
  for (let i = 2; taken.has(slug) && i < 50; i++) slug = `${baseSlug}-${i}`;

  await db.transaction(async (tx) => {
    await tx.insert(inboxes).values({
      id: inboxId,
      organizationId,
      projectId,
      name,
      slug,
      defaultSenderId: input.defaultSenderId ?? null,
    });
    await tx.insert(inboxRoutes).values({
      id: rid("irt"),
      inboxId,
      receivingDomainId: domain.id,
      localPart,
    });
    // The creator is a member implicitly; without this an admin who later loses
    // the admin role would silently lose the inbox they built.
    const { getTenantContext } = await import("../../../lib/auth");
    const ctx = await getTenantContext();
    await tx.insert(inboxMembers).values({
      id: rid("imb"),
      inboxId,
      userId: ctx.user.userId,
      role: "manager",
    });
  });

  revalidatePath("/inbox/settings");
  revalidatePath("/inbox");
  return { ok: true as const, inboxId, slug };
}

export async function createInbox(input: {
  inboxId: string;
  name: string;
  defaultSenderId?: string | null;
}) {
  await requireInboxCapability(input.inboxId, "manageSettings");
  const name = input.name.trim().slice(0, 120);
  if (name.length < 2) throw new Error("Give the inbox a name.");

  const db = getDb();
  const [existing] = await db.select().from(inboxes).where(eq(inboxes.id, input.inboxId)).limit(1);
  if (!existing) throw new Error("Inbox not found.");

  await db
    .update(inboxes)
    .set({
      name,
      defaultSenderId:
        input.defaultSenderId === undefined ? existing.defaultSenderId : input.defaultSenderId,
      updatedAt: new Date(),
    })
    .where(eq(inboxes.id, input.inboxId));
  revalidatePath("/inbox/settings");
  revalidatePath("/inbox");
  return { ok: true as const };
}

/** Add or remove a recipient address (local part) for an inbox. */
export async function setInboxRoute(input: {
  inboxId: string;
  receivingDomainId: string;
  localPart: string;
  enabled: boolean;
}) {
  await requireInboxCapability(input.inboxId, "manageSettings");
  const db = getDb();

  const [domain] = await db
    .select()
    .from(receivingDomains)
    .where(eq(receivingDomains.id, input.receivingDomainId))
    .limit(1);
  if (!domain) throw new Error("Receiving domain not found.");

  const [inbox] = await db.select().from(inboxes).where(eq(inboxes.id, input.inboxId)).limit(1);
  if (!inbox || inbox.projectId !== domain.projectId) {
    throw new Error("That receiving domain belongs to a different project.");
  }

  const localPart = input.localPart.trim().toLowerCase();
  if (!/^(\*|[a-z0-9][a-z0-9._-]{0,63})$/.test(localPart)) {
    throw new Error(
      "Addresses may use letters, digits, dots, dashes and underscores — or * for catch-all."
    );
  }

  if (input.enabled) {
    // The unique index is the real guard; catch it and explain rather than 500.
    try {
      await db.insert(inboxRoutes).values({
        id: rid("irt"),
        inboxId: input.inboxId,
        receivingDomainId: input.receivingDomainId,
        localPart,
      });
    } catch {
      throw new Error(
        `An address rule for ${localPart}@${domain.domain} already exists. One address can only route to one inbox.`
      );
    }
  } else {
    await db
      .delete(inboxRoutes)
      .where(
        and(
          eq(inboxRoutes.inboxId, input.inboxId),
          eq(inboxRoutes.receivingDomainId, input.receivingDomainId),
          eq(inboxRoutes.localPart, localPart)
        )
      );
  }
  revalidatePath("/inbox/settings");
  return { ok: true as const };
}

export async function setInboxMember(input: {
  inboxId: string;
  userId: string;
  role: "viewer" | "member" | "manager" | "none";
}) {
  await requireInboxCapability(input.inboxId, "manageMembers");
  const db = getDb();

  const [user] = await db.select().from(users).where(eq(users.id, input.userId)).limit(1);
  if (!user) throw new Error("Person not found.");

  if (input.role === "none") {
    await db
      .delete(inboxMembers)
      .where(and(eq(inboxMembers.inboxId, input.inboxId), eq(inboxMembers.userId, input.userId)));
  } else {
    const [existing] = await db
      .select()
      .from(inboxMembers)
      .where(and(eq(inboxMembers.inboxId, input.inboxId), eq(inboxMembers.userId, input.userId)))
      .limit(1);
    if (existing) {
      await db
        .update(inboxMembers)
        .set({ role: input.role })
        .where(eq(inboxMembers.id, existing.id));
    } else {
      await db.insert(inboxMembers).values({
        id: rid("imb"),
        inboxId: input.inboxId,
        userId: input.userId,
        role: input.role,
      });
    }
  }
  revalidatePath("/inbox/settings");
  return { ok: true as const };
}

export async function assignablePeople(inboxId: string) {
  await resolveInboxAccess(inboxId);
  return inboxAssignableMembers(getDb(), inboxId);
}

function replySubject(subject: string | null): string {
  const base = (subject ?? "").trim();
  if (!base) return "Re: your message";
  return /^re\s*:/i.test(base) ? base : `Re: ${base}`;
}

/** Minimal, escaped HTML for a plain-text reply. Never injects raw input. */
function textToHtml(text: string): string {
  const escaped = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<div style="white-space:pre-wrap;font-family:system-ui,sans-serif">${escaped}</div>`;
}
