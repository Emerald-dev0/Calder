import { Hono, type Context } from "hono";
import { and, eq } from "drizzle-orm";
import {
  getConversation,
  getDb,
  inboxConversations,
  inboxes,
  listConversations,
  listInboxesForProject,
} from "@calder/db";
import type { Env } from "../app.js";
import { authMiddleware, requireScope, type AuthContext } from "../middleware/auth.js";
import { AppError } from "../errors/index.js";
import { requireInboundEnabled } from "../lib/inbound/ingest.js";

/**
 * Read access to shared inboxes for API-key clients.
 *
 * Scoped by the key's project, like every other route: an inbox id from another
 * project is a 404, not a 403, so the endpoint never confirms the existence of
 * someone else's data. Writes (replies, notes, assignment) are intentionally
 * dashboard-only in this release — they need a signed-in human as the author,
 * and an API key is not a person.
 */
const inboxesRoute = new Hono<Env>();

function projectAuth(c: Context<Env>): AuthContext {
  return c.get("auth" as never) as AuthContext;
}

inboxesRoute.get("/", authMiddleware, async (c) => {
  requireInboundEnabled();
  requireScope(projectAuth(c), "read");
  const rows = await listInboxesForProject(getDb(), projectAuth(c).projectId);
  return c.json({
    data: rows.map((row) => ({
      id: row.id,
      name: row.name,
      slug: row.slug,
      status: row.status,
      addresses: row.routes.map((r) => r.address),
      open_conversations: row.openConversations,
      last_message_at: row.lastMessageAt ? row.lastMessageAt.toISOString() : null,
      replies_enabled: Boolean(row.defaultSenderId),
    })),
  });
});

inboxesRoute.get("/:id/conversations", authMiddleware, async (c) => {
  requireInboundEnabled();
  const auth = projectAuth(c);
  requireScope(auth, "read");

  const db = getDb();
  const [inbox] = await db
    .select({ id: inboxes.id, projectId: inboxes.projectId })
    .from(inboxes)
    .where(and(eq(inboxes.id, c.req.param("id")), eq(inboxes.projectId, auth.projectId)))
    .limit(1);
  if (!inbox) throw new AppError("not_found", "Inbox not found.", 404);

  const statusParam = c.req.query("status");
  const status =
    statusParam === "open" ||
    statusParam === "pending" ||
    statusParam === "closed" ||
    statusParam === "all"
      ? statusParam
      : "open";
  const limitParam = Number(c.req.query("limit") ?? "30");
  const limit = Number.isFinite(limitParam)
    ? Math.min(Math.max(Math.trunc(limitParam), 1), 100)
    : 30;

  const { rows, nextCursor } = await listConversations(db, {
    inboxId: inbox.id,
    status,
    q: c.req.query("q")?.trim() || undefined,
    limit,
  });

  return c.json({
    data: rows.map((row) => ({
      id: row.id,
      subject: row.subject,
      status: row.status,
      participants: row.participants,
      assignee_user_id: row.assigneeUserId,
      message_count: row.messageCount,
      labels: row.labels,
      last_message_at: row.lastMessageAt.toISOString(),
    })),
    next_cursor: nextCursor,
  });
});

inboxesRoute.get("/:id/conversations/:conversationId", authMiddleware, async (c) => {
  requireInboundEnabled();
  const auth = projectAuth(c);
  requireScope(auth, "read");

  const db = getDb();
  const [conversation] = await db
    .select({ id: inboxConversations.id, inboxId: inboxConversations.inboxId })
    .from(inboxConversations)
    .where(
      and(
        eq(inboxConversations.id, c.req.param("conversationId")),
        eq(inboxConversations.inboxId, c.req.param("id")),
        eq(inboxConversations.projectId, auth.projectId)
      )
    )
    .limit(1);
  if (!conversation) throw new AppError("not_found", "Conversation not found.", 404);

  const detail = await getConversation(db, { conversationId: conversation.id });
  if (!detail) throw new AppError("not_found", "Conversation not found.", 404);

  return c.json({
    data: {
      id: detail.id,
      subject: detail.subject,
      status: detail.status,
      participants: detail.participants,
      assignee_user_id: detail.assigneeUserId,
      labels: detail.labels,
      messages: detail.messages.map((m) => ({
        kind: m.kind,
        id: m.id,
        at: m.at.toISOString(),
        from: m.kind === "inbound" ? m.fromAddress : null,
        author_user_id: m.authorUserId,
        email_id: m.emailId,
        subject: m.subject,
        body: { text: m.bodyText, html: m.bodyHtml },
        attachments: m.attachments,
      })),
      // Notes are internal by definition; the API returns them because the key
      // holder already has full project access, but they are clearly separated.
      notes: detail.notes.map((n) => ({
        id: n.id,
        author_user_id: n.authorUserId,
        body: n.body,
        created_at: n.createdAt.toISOString(),
      })),
    },
  });
});

export default inboxesRoute;
