import { describe, expect, it } from "vitest";
import {
  automationReason,
  NOTIFICATION_EMAIL_HOURLY_CAP,
  planRecipients,
  replyEmailAllowed,
  REPLY_EMAIL_THROTTLE_MS,
  withinEmailCap,
  type MessageContext,
} from "./notification-policy.js";

/**
 * Who gets told about inbound mail.
 *
 * Two failure modes are being defended against, and both are asserted as
 * negatives: an auto-responder bouncing notifications back and forth forever,
 * and a shared inbox emailing six people about the same message.
 */

const humans: MessageContext = {
  headers: { "auto-submitted": "no" },
  fromAddress: "ada@example.com",
  subject: "Where is my order?",
};

const members = [
  { userId: "usr_ada", notify: true },
  { userId: "usr_grace", notify: true },
  { userId: "usr_linus", notify: false },
];

describe("automationReason", () => {
  it("treats explicit `auto-submitted: no` as a human", () => {
    expect(automationReason(humans)).toBeNull();
  });

  it("treats any other auto-submitted value as machine mail", () => {
    for (const value of ["auto-replied", "auto-generated", "auto-notified"]) {
      expect(automationReason({ ...humans, headers: { "auto-submitted": value } })).toBe(
        "auto_submitted"
      );
    }
  });

  it("silences bulk, list and junk precedence", () => {
    expect(automationReason({ ...humans, headers: { precedence: "bulk" } })).toBe(
      "precedence_bulk"
    );
    expect(automationReason({ ...humans, headers: { precedence: "List" } })).toBe(
      "precedence_bulk"
    );
    expect(automationReason({ ...humans, headers: { precedence: "junk" } })).toBe(
      "precedence_bulk"
    );
  });

  it("silences vacation responders and mailing lists", () => {
    expect(automationReason({ ...humans, headers: { "x-autoreply": "yes" } })).toBe(
      "auto_reply_header"
    );
    expect(automationReason({ ...humans, headers: { "list-id": "<x.lists.example.com>" } })).toBe(
      "list_mail"
    );
    expect(automationReason({ ...humans, headers: { "list-unsubscribe": "<mailto:x@y>" } })).toBe(
      "list_mail"
    );
  });

  it("silences bounces by local part but not by convention", () => {
    expect(automationReason({ ...humans, fromAddress: "MAILER-DAEMON@example.com" })).toBe(
      "machine_sender"
    );
    expect(automationReason({ ...humans, fromAddress: "postmaster@example.com" })).toBe(
      "machine_sender"
    );
    // `noreply@` is a real business writing to support; a human reads that.
    expect(automationReason({ ...humans, fromAddress: "noreply@example.com" })).toBeNull();
  });

  it("checks auto-submitted before the softer signals", () => {
    expect(
      automationReason({
        ...humans,
        headers: { "auto-submitted": "auto-replied", precedence: "bulk" },
      })
    ).toBe("auto_submitted");
  });
});

describe("planRecipients", () => {
  it("tells every member about a new conversation, except the actor", () => {
    const plan = planRecipients({
      kind: "inbox.new_conversation",
      members,
      assigneeUserId: null,
      actorUserId: "usr_ada",
      message: humans,
    });
    expect(plan.recipients.map((r) => r.userId)).toEqual(["usr_grace", "usr_linus"]);
    // Muted member still gets the row; email is what they switched off.
    expect(plan.recipients.find((r) => r.userId === "usr_linus")?.email).toBe(false);
  });

  it("keeps the in-app row but drops the email for a muted member", () => {
    const plan = planRecipients({
      kind: "inbox.new_conversation",
      members: [{ userId: "usr_linus", notify: false }],
      assigneeUserId: null,
      message: humans,
    });
    expect(plan.recipients).toEqual([{ userId: "usr_linus", email: false }]);
  });

  it("silences machine mail entirely", () => {
    const plan = planRecipients({
      kind: "inbox.new_conversation",
      members,
      assigneeUserId: null,
      message: { ...humans, headers: { "auto-submitted": "auto-replied" } },
    });
    expect(plan.recipients).toEqual([]);
    expect(plan.reason).toBe("auto_submitted");
  });

  it("notifies only the new assignee, and never the assigner", () => {
    const plan = planRecipients({
      kind: "inbox.assigned",
      members,
      assigneeUserId: "usr_grace",
      actorUserId: "usr_ada",
    });
    expect(plan.recipients).toEqual([{ userId: "usr_grace", email: true }]);

    const selfAssign = planRecipients({
      kind: "inbox.assigned",
      members,
      assigneeUserId: "usr_ada",
      actorUserId: "usr_ada",
    });
    expect(selfAssign.recipients).toEqual([]);
    expect(selfAssign.reason).toBe("self_only");
  });

  it("does not notify anybody when an unassigned conversation gets a reply", () => {
    const plan = planRecipients({
      kind: "inbox.reply_received",
      members,
      assigneeUserId: null,
      message: humans,
    });
    expect(plan.recipients).toEqual([]);
    expect(plan.reason).toBe("unassigned");
  });

  it("notifies the assignee of a reply, respecting their mute", () => {
    expect(
      planRecipients({
        kind: "inbox.reply_received",
        members,
        assigneeUserId: "usr_grace",
        message: humans,
      }).recipients
    ).toEqual([{ userId: "usr_grace", email: true }]);

    expect(
      planRecipients({
        kind: "inbox.reply_received",
        members,
        assigneeUserId: "usr_linus",
        message: humans,
      }).recipients
    ).toEqual([{ userId: "usr_linus", email: false }]);
  });

  it("does not notify the assignee about their own outbound reply", () => {
    const plan = planRecipients({
      kind: "inbox.reply_received",
      members,
      assigneeUserId: "usr_grace",
      actorUserId: "usr_grace",
      message: humans,
    });
    expect(plan.recipients).toEqual([]);
    expect(plan.reason).toBe("self_only");
  });

  it("reports an empty inbox instead of pretending it notified somebody", () => {
    const plan = planRecipients({
      kind: "inbox.new_conversation",
      members: [],
      assigneeUserId: null,
      message: humans,
    });
    expect(plan.recipients).toEqual([]);
    expect(plan.reason).toBe("no_members");
  });
});

describe("email caps", () => {
  it("stops at the hourly cap", () => {
    expect(withinEmailCap(0)).toBe(true);
    expect(withinEmailCap(NOTIFICATION_EMAIL_HOURLY_CAP - 1)).toBe(true);
    expect(withinEmailCap(NOTIFICATION_EMAIL_HOURLY_CAP)).toBe(false);
  });

  it("throttles repeat reply emails to one an hour per conversation", () => {
    const now = new Date("2026-01-01T12:00:00Z");
    expect(replyEmailAllowed(null, now)).toBe(true);
    expect(replyEmailAllowed(new Date(now.getTime() - 10 * 60 * 1000), now)).toBe(false);
    expect(replyEmailAllowed(new Date(now.getTime() - REPLY_EMAIL_THROTTLE_MS), now)).toBe(true);
  });
});
