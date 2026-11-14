/**
 * Who gets told about inbound mail — and, more importantly, who does not.
 *
 * Notification decisions are pure so the rules can be stated once and tested
 * exhaustively. The rules exist because the naive version ("email everyone, for
 * every message") fails in three specific ways:
 *
 *  1. **Loops.** A support inbox replies; the sender is a vacation responder; it
 *     replies back; we notify again. Twenty minutes later there are four hundred
 *     messages. Machine mail must never trigger a notification.
 *  2. **Self-notification.** The person who just replied does not need to be
 *     told that they replied.
 *  3. **Volume.** One email per message turns an inbox into noise, and noise is
 *     filtered — after which the important notifications are filtered too.
 *
 * The output is a decision plus a reason, so callers can log *why* nobody was
 * notified instead of leaving an operator guessing.
 */

export interface MessageContext {
  /** Lower-cased header map, as stored on the inbound message. */
  headers: Record<string, string>;
  fromAddress: string | null;
  subject?: string | null;
}

export type AutomationReason =
  "auto_submitted" | "precedence_bulk" | "auto_reply_header" | "list_mail" | "machine_sender";

/**
 * Local parts that are never a human opening a conversation.
 *
 * Deliberately short: `noreply@` is excluded on purpose, because plenty of real
 * businesses write to support from a `noreply` address and a human does read
 * that reply.
 */
const MACHINE_LOCAL_PARTS = new Set([
  "mailer-daemon",
  "postmaster",
  "mail-daemon",
  "bounce",
  "bounces",
]);

/** Is this message machine-generated (and therefore silent)? */
export function automationReason(message: MessageContext): AutomationReason | null {
  const headers = message.headers ?? {};

  // RFC 3834. `auto-generated` is bulk-ish; `auto-replied` is a vacation
  // responder. Both are silent. `no` is the explicit human marker.
  const autoSubmitted = (headers["auto-submitted"] ?? "").trim().toLowerCase();
  if (autoSubmitted && autoSubmitted !== "no") return "auto_submitted";

  const precedence = (headers["precedence"] ?? "").trim().toLowerCase();
  if (precedence === "bulk" || precedence === "list" || precedence === "junk") {
    return "precedence_bulk";
  }

  if (headers["x-autoreply"] || headers["x-autorespond"] || headers["x-auto-response-suppress"]) {
    return "auto_reply_header";
  }

  // Mailing-list traffic. Worth reading, not worth interrupting someone for.
  if (headers["list-id"] || headers["list-unsubscribe"]) return "list_mail";

  const local = (message.fromAddress ?? "").split("@")[0]?.trim().toLowerCase() ?? "";
  if (local && MACHINE_LOCAL_PARTS.has(local)) return "machine_sender";

  return null;
}

export type NotificationKind = "inbox.new_conversation" | "inbox.assigned" | "inbox.reply_received";

export interface CandidateMember {
  userId: string;
  /** `inbox_members.notify`: false means "in-app only, do not email me". */
  notify: boolean;
}

export interface RecipientInput {
  kind: NotificationKind;
  members: CandidateMember[];
  /** Current assignee of the conversation, if any. */
  assigneeUserId: string | null;
  /** The person who caused the event (the replier, or the assigner). */
  actorUserId?: string | null;
  /** Set for inbound kinds; automation silences the whole event. */
  message?: MessageContext | null;
}

export interface RecipientPlan {
  recipients: Array<{ userId: string; email: boolean }>;
  /** Why the list is empty, when it is. */
  reason?: AutomationReason | "no_members" | "self_only" | "unassigned" | "no_assignee";
}

/**
 * Decide the recipients for one event.
 *
 * - `new_conversation` → every member of the inbox. A shared queue only works
 *   if everyone can see the work arriving.
 * - `assigned` → only the new assignee, and never the person doing the
 *   assigning.
 * - `reply_received` → only the assignee. A reply on an untouched conversation
 *   is already covered by the arrival notification.
 *
 * `email` mirrors `inbox_members.notify`: muting suppresses the interruption,
 * not the in-app entry, so the badge still shows the work.
 */
export function planRecipients(input: RecipientInput): RecipientPlan {
  if (input.message) {
    const automated = automationReason(input.message);
    if (automated) return { recipients: [], reason: automated };
  }

  const actor = input.actorUserId ?? null;

  if (input.kind === "inbox.assigned") {
    const assignee = input.assigneeUserId;
    if (!assignee) return { recipients: [], reason: "no_assignee" };
    if (assignee === actor) return { recipients: [], reason: "self_only" };
    const member = input.members.find((m) => m.userId === assignee);
    // An assignee who is not an inbox member can still be a workspace admin
    // (they can open every inbox), so the row is created; email follows their
    // inbox preference when it exists.
    return { recipients: [{ userId: assignee, email: member ? member.notify : true }] };
  }

  if (input.kind === "inbox.reply_received") {
    const assignee = input.assigneeUserId;
    if (!assignee) return { recipients: [], reason: "unassigned" };
    if (assignee === actor) return { recipients: [], reason: "self_only" };
    const member = input.members.find((m) => m.userId === assignee);
    return { recipients: [{ userId: assignee, email: member ? member.notify : true }] };
  }

  const recipients = input.members
    .filter((m) => m.userId !== actor)
    .map((m) => ({ userId: m.userId, email: m.notify }));

  if (recipients.length === 0) return { recipients: [], reason: "no_members" };
  return { recipients };
}

/** Maximum notification emails one person receives per rolling hour. */
export const NOTIFICATION_EMAIL_HOURLY_CAP = 5;

/**
 * Whether an email may still be sent to this person.
 *
 * The badge is the primary signal; email is the escalation, and escalation that
 * fires ten times an hour is just noise with a delay. Past the cap the in-app
 * row stands and nothing is lost.
 */
export function withinEmailCap(emailsSentLastHour: number): boolean {
  return emailsSentLastHour < NOTIFICATION_EMAIL_HOURLY_CAP;
}

/**
 * Whether a *reply* reminder may be emailed now.
 *
 * A conversation is re-notified at most once an hour: a customer sending five
 * quick follow-ups must not produce five emails.
 */
export const REPLY_EMAIL_THROTTLE_MS = 60 * 60 * 1000;

export function replyEmailAllowed(lastEmailedAt: Date | null, now: Date): boolean {
  if (!lastEmailedAt) return true;
  return now.getTime() - lastEmailedAt.getTime() >= REPLY_EMAIL_THROTTLE_MS;
}
