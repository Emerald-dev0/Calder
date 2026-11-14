"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Send, StickyNote } from "lucide-react";
import { addNote, replyToConversation, setConversationState } from "../actions";
import { DsBanner, DsButton, DsSelect, DsTextarea } from "../../../../components/design-system";

/**
 * Conversation composer.
 *
 * Two different things live here and must never be confused visually: a reply
 * (goes to the customer, from a verified sender identity, metered as outbound)
 * and an internal note (stays in the workspace). The note is rendered with an
 * explicit "not sent" label and the reply button says who it sends as.
 */
export function ConversationComposer({
  conversationId,
  canReply,
  canNote,
  senderLabel,
  recipient,
  disabledReason,
}: {
  conversationId: string;
  canReply: boolean;
  canNote: boolean;
  senderLabel: string | null;
  recipient: string | null;
  disabledReason?: string | null;
}) {
  const router = useRouter();
  const [mode, setMode] = React.useState<"reply" | "note">("reply");
  const [body, setBody] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [sent, setSent] = React.useState<string | null>(null);

  const canSend = mode === "reply" ? canReply && !disabledReason : canNote;

  async function submit() {
    setBusy(true);
    setError(null);
    setSent(null);
    try {
      if (mode === "reply") {
        await replyToConversation(conversationId, body);
        setSent("Reply queued for delivery.");
      } else {
        await addNote(conversationId, body);
        setSent("Note added — the customer does not see it.");
      }
      setBody("");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ds-card" style={{ marginTop: 16 }}>
      <div className="ds-card-header">
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button
            type="button"
            className={`ds-btn ${mode === "reply" ? "ds-btn-primary" : "ds-btn-ghost"}`}
            onClick={() => setMode("reply")}
            aria-pressed={mode === "reply"}
          >
            <Send size={13} /> Reply
          </button>
          <button
            type="button"
            className={`ds-btn ${mode === "note" ? "ds-btn-primary" : "ds-btn-ghost"}`}
            onClick={() => setMode("note")}
            aria-pressed={mode === "note"}
          >
            <StickyNote size={13} /> Internal note
          </button>
        </div>
        <p className="ds-card-subtitle" style={{ margin: 0 }}>
          {mode === "reply"
            ? recipient
              ? `Sends to ${recipient}${senderLabel ? ` from ${senderLabel}` : ""}. Counts as an outbound email.`
              : "There is no inbound sender to reply to."
            : "Visible to your team only. Never sent to the customer."}
        </p>
      </div>
      <div className="ds-card-body">
        {disabledReason && mode === "reply" && (
          <div style={{ marginBottom: 10 }}>
            <DsBanner tone="warning" title="Replies are unavailable" description={disabledReason} />
          </div>
        )}
        {error && (
          <div style={{ marginBottom: 10 }}>
            <DsBanner tone="danger" title="Not saved" description={error} />
          </div>
        )}
        {sent && (
          <div style={{ marginBottom: 10 }}>
            <DsBanner tone="success" title="Done" description={sent} />
          </div>
        )}
        <DsTextarea
          value={body}
          onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setBody(e.target.value)}
          rows={5}
          placeholder={mode === "reply" ? "Write your reply…" : "Add context for your team…"}
          disabled={busy || !canSend}
          aria-label={mode === "reply" ? "Reply" : "Internal note"}
        />
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 10 }}>
          <DsButton onClick={submit} disabled={busy || !canSend || body.trim().length === 0}>
            {busy ? "Saving…" : mode === "reply" ? "Send reply" : "Add note"}
          </DsButton>
        </div>
      </div>
    </div>
  );
}

export function ConversationControls({
  conversationId,
  status,
  assigneeUserId,
  members,
  version,
  canAssign,
  canTriage,
}: {
  conversationId: string;
  status: string;
  assigneeUserId: string | null;
  members: Array<{ userId: string; name: string | null; email: string }>;
  version: number;
  canAssign: boolean;
  canTriage: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function patch(next: {
    status?: "open" | "pending" | "closed";
    assigneeUserId?: string | null;
  }) {
    setBusy(true);
    setError(null);
    try {
      await setConversationState(conversationId, { ...next, expectedVersion: version });
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: 10 }}>
      {error && <DsBanner tone="danger" title="Could not update" description={error} />}
      <label style={{ display: "grid", gap: 4, fontSize: 12 }}>
        Status
        <DsSelect
          value={status}
          disabled={busy || !canTriage}
          onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
            patch({ status: e.target.value as "open" | "pending" | "closed" })
          }
        >
          <option value="open">Open</option>
          <option value="pending">Pending</option>
          <option value="closed">Closed</option>
        </DsSelect>
      </label>
      <label style={{ display: "grid", gap: 4, fontSize: 12 }}>
        Assigned to
        <DsSelect
          value={assigneeUserId ?? ""}
          disabled={busy || !canAssign}
          onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
            patch({ assigneeUserId: e.target.value || null })
          }
        >
          <option value="">Unassigned</option>
          {members.map((m) => (
            <option key={m.userId} value={m.userId}>
              {m.name ?? m.email}
            </option>
          ))}
        </DsSelect>
      </label>
    </div>
  );
}
