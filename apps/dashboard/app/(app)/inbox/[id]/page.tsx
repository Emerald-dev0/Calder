import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import {
  getConversation,
  getDb,
  inboxConversations,
  inboxAssignableMembers,
  inboxes,
  markConversationNotificationsRead,
  senderIdentities,
} from "@calder/db";
import { ArrowLeft, Inbox, Paperclip, StickyNote } from "lucide-react";
import { DsBanner, DsPageHeader, StatusPill } from "../../../../components/design-system";
import { resolveInboxAccess, InboxAccessError } from "../../../../lib/inbox/guard";
import { ConversationComposer, ConversationControls } from "./panel";

/**
 * One conversation.
 *
 * Access is decided by `resolveInboxAccess` (organisation membership + inbox
 * membership), not by the URL: a conversation id from another workspace or from
 * an inbox this user was not added to renders 404, exactly like a missing row.
 *
 * HTML bodies are shown in a sandboxed iframe with scripts disabled rather than
 * injected into the page — inbound mail is attacker-controlled content.
 */
export default async function ConversationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();

  const [conversation] = await db
    .select()
    .from(inboxConversations)
    .where(eq(inboxConversations.id, id))
    .limit(1);
  if (!conversation) notFound();

  let access;
  try {
    access = await resolveInboxAccess(conversation.inboxId);
  } catch (err) {
    if (err instanceof InboxAccessError) notFound();
    throw err;
  }

  const [detail, members, inboxRow] = await Promise.all([
    getConversation(db, { conversationId: id }),
    inboxAssignableMembers(db, conversation.inboxId),
    db.select().from(inboxes).where(eq(inboxes.id, conversation.inboxId)).limit(1),
  ]);
  if (!detail) notFound();

  // Opening a conversation is reading it. Marking its notifications here keeps
  // the bell honest without asking the user to dismiss anything by hand; the
  // write is scoped to this user and idempotent, so a re-render is harmless.
  await markConversationNotificationsRead(db, {
    userId: access.userId,
    conversationId: id,
  });

  const inbox = inboxRow[0];
  const sender = inbox?.defaultSenderId
    ? (
        await db
          .select()
          .from(senderIdentities)
          .where(eq(senderIdentities.id, inbox.defaultSenderId))
          .limit(1)
      )[0]
    : null;

  const lastInbound = [...detail.messages].reverse().find((m) => m.kind === "inbound");
  const recipient = lastInbound?.fromAddress ?? null;

  const caps = access.capabilities;
  const replyDisabledReason = caps.reply
    ? inbox?.defaultSenderId
      ? null
      : "This inbox has no default sender identity. An owner can set one in the inbox settings."
    : "Your inbox role does not allow replying.";

  return (
    <div>
      <DsPageHeader
        icon={<Inbox size={18} />}
        title={detail.subject ?? "(no subject)"}
        badge={<StatusPill status={detail.status} />}
        description={
          <span>
            {detail.participants.slice(0, 4).join(", ")}
            {detail.participants.length > 4 ? ` +${detail.participants.length - 4}` : ""}
          </span>
        }
        actions={
          <Link className="ds-btn ds-btn-ghost" href={`/inbox?inbox=${conversation.inboxId}`}>
            <ArrowLeft size={13} /> Back to {inbox?.name ?? "inbox"}
          </Link>
        }
      />

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 260px", gap: 20 }}>
        <div>
          {detail.messages.length === 0 && (
            <DsBanner
              tone="neutral"
              title="No messages in this conversation yet"
              description="The conversation exists but its messages could not be read."
            />
          )}

          {detail.messages.map((message) => (
            <div key={message.id} className="ds-card" style={{ marginBottom: 12, padding: 16 }}>
              <div
                style={{
                  display: "flex",
                  gap: 8,
                  alignItems: "baseline",
                  flexWrap: "wrap",
                  marginBottom: 8,
                }}
              >
                <StatusPill
                  status={message.kind === "inbound" ? "received" : "sent"}
                  label={message.kind === "inbound" ? "Received" : "Reply sent"}
                />
                <strong style={{ fontSize: 13 }}>
                  {message.kind === "inbound"
                    ? (message.fromName ?? message.fromAddress ?? "Unknown sender")
                    : "You"}
                </strong>
                {message.kind === "inbound" && message.fromAddress && (
                  <span className="mono" style={{ fontSize: 11, opacity: 0.7 }}>
                    {message.fromAddress}
                  </span>
                )}
                <span style={{ fontSize: 11, opacity: 0.6 }}>
                  {message.at.toISOString().replace("T", " ").slice(0, 16)} UTC
                </span>
              </div>

              {message.bodyText ? (
                <div style={{ whiteSpace: "pre-wrap", fontSize: 13, lineHeight: 1.55 }}>
                  {message.bodyText}
                </div>
              ) : message.bodyHtml ? (
                <iframe
                  title="Message body"
                  // Attacker-controlled HTML: no scripts, no same-origin.
                  sandbox=""
                  srcDoc={message.bodyHtml}
                  style={{
                    width: "100%",
                    height: 320,
                    border: "1px solid var(--color-border)",
                    borderRadius: 8,
                  }}
                />
              ) : (
                <p style={{ fontSize: 13, opacity: 0.7, margin: 0 }}>
                  This message has no readable text body.
                </p>
              )}

              {message.bodyText && message.bodyHtml && (
                <details style={{ marginTop: 10 }}>
                  <summary style={{ fontSize: 12, cursor: "pointer", opacity: 0.75 }}>
                    View HTML version
                  </summary>
                  <iframe
                    title="HTML version"
                    sandbox=""
                    srcDoc={message.bodyHtml}
                    style={{
                      width: "100%",
                      height: 320,
                      border: "1px solid var(--color-border)",
                      borderRadius: 8,
                      marginTop: 8,
                    }}
                  />
                </details>
              )}

              {message.attachments.length > 0 && (
                <div style={{ marginTop: 10, display: "grid", gap: 6 }}>
                  {message.attachments.map((attachment) => (
                    <div
                      key={attachment.id}
                      style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12 }}
                    >
                      <Paperclip size={12} />
                      <span className="mono">{attachment.filename ?? "unnamed"}</span>
                      <span style={{ opacity: 0.6 }}>
                        {(attachment.sizeBytes / 1024).toFixed(1)} KB
                      </span>
                      {attachment.stored ? (
                        <a
                          className="ds-btn ds-btn-ghost"
                          href={`/api/inbox/attachment?message=${message.id}&attachment=${attachment.id}`}
                        >
                          Download
                        </a>
                      ) : (
                        <span style={{ opacity: 0.6 }}>
                          not stored (exceeded the attachment limit)
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}

          {detail.notes.length > 0 && (
            <div className="ds-card" style={{ padding: 16, marginBottom: 12 }}>
              <h2
                className="ds-card-title"
                style={{ display: "flex", gap: 6, alignItems: "center" }}
              >
                <StickyNote size={14} /> Internal notes
              </h2>
              <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
                {detail.notes.map((note) => (
                  <div
                    key={note.id}
                    style={{ borderLeft: "3px solid var(--color-warning)", paddingLeft: 10 }}
                  >
                    <div style={{ fontSize: 11, opacity: 0.7 }}>
                      {note.authorName ?? "Someone"} ·{" "}
                      {note.createdAt.toISOString().slice(0, 16).replace("T", " ")} UTC
                    </div>
                    <div style={{ whiteSpace: "pre-wrap", fontSize: 13 }}>{note.body}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <ConversationComposer
            conversationId={detail.id}
            canReply={caps.reply}
            canNote={caps.note}
            senderLabel={sender ? sender.email : null}
            recipient={recipient}
            disabledReason={
              caps.reply && recipient
                ? replyDisabledReason
                : (disabledReasonFor(recipient) ?? replyDisabledReason)
            }
          />
        </div>

        <aside>
          <div className="ds-card" style={{ padding: 16 }}>
            <h2 className="ds-card-title">Conversation</h2>
            <ConversationControls
              conversationId={detail.id}
              status={detail.status}
              assigneeUserId={detail.assigneeUserId}
              members={members}
              version={conversation.version}
              canAssign={caps.assign}
              canTriage={caps.triage}
            />
            <div style={{ marginTop: 14, fontSize: 12, opacity: 0.75 }}>
              <div>{detail.messages.length} message(s)</div>
              <div>{detail.participants.length} participant(s)</div>
              {detail.labels.length > 0 && (
                <div>Labels: {detail.labels.map((l) => l.name).join(", ")}</div>
              )}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

function disabledReasonFor(recipient: string | null): string | null {
  return recipient ? null : "No inbound sender to reply to.";
}
