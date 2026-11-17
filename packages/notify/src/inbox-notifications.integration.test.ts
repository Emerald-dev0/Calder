import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import {
  getDb,
  inboxConversations,
  inboxMembers,
  inboxes,
  notifications,
  organizations,
  projects,
  users,
  type DbClient,
} from "@calder/db";
import { notifyInboxActivity } from "./inbox-notifications.js";

const gate = process.env.RUN_INTEGRATION_TESTS === "1" ? describe : describe.skip;

/**
 * The inbox notification dispatcher, wired to real tables.
 *
 * The provider is a recording stub — this is about *decisions*: who gets a row,
 * who gets an email, and what happens when the same event arrives twice. The
 * three failure modes being defended against are a duplicate email from an SNS
 * redelivery, a reply loop with an auto-responder, and a muted member being
 * emailed anyway.
 */
gate("inbox notifications (live Postgres)", () => {
  const db: DbClient = getDb();
  const suffix = randomUUID().replace(/-/g, "").slice(0, 8);
  const orgId = `org_inx_${suffix}`;
  const projectId = `prj_inx_${suffix}`;
  const inboxId = `inbx_inx_${suffix}`;
  const conversationId = `cnv_inx_${suffix}`;
  const ada = `usr_inx_a_${suffix}`;
  const grace = `usr_inx_g_${suffix}`;
  const linus = `usr_inx_l_${suffix}`;

  const sent: Array<{ id: string; to: string; idempotencyKey: string }> = [];

  beforeAll(async () => {
    await db.insert(users).values([
      { id: ada, email: `ada-${suffix}@example.test`, name: "Ada" },
      { id: grace, email: `grace-${suffix}@example.test`, name: "Grace" },
      { id: linus, email: `linus-${suffix}@example.test`, name: "Linus" },
    ]);
    await db
      .insert(organizations)
      .values({ id: orgId, name: `Notify ${suffix}`, slug: `notify-inx-${suffix}` });
    await db.insert(projects).values({
      id: projectId,
      organizationId: orgId,
      name: "Notify",
      slug: `notify-inx-p-${suffix}`,
    });
    await db.insert(inboxes).values({
      id: inboxId,
      organizationId: orgId,
      projectId,
      name: "Support",
      slug: `support-inx-${suffix}`,
    });
    await db.insert(inboxConversations).values({
      id: conversationId,
      organizationId: orgId,
      projectId,
      inboxId,
      subject: "Where is my order?",
      threadKey: `tk-inx-${suffix}`,
      participants: ["customer@acme.test"],
      firstMessageAt: new Date(),
      lastMessageAt: new Date(),
    });
    await db.insert(inboxMembers).values([
      { id: `imb_a_${suffix}`, inboxId, userId: ada, role: "manager" },
      { id: `imb_g_${suffix}`, inboxId, userId: grace, role: "member" },
      { id: `imb_l_${suffix}`, inboxId, userId: linus, role: "member", notify: false },
    ]);
  });

  afterAll(async () => {
    await db.delete(organizations).where(eq(organizations.id, orgId));
    await db.delete(users).where(eq(users.id, ada));
    await db.delete(users).where(eq(users.id, grace));
    await db.delete(users).where(eq(users.id, linus));
  });

  const send = async (params: { id: string; to: string; idempotencyKey: string }) => {
    sent.push({ id: params.id, to: params.to, idempotencyKey: params.idempotencyKey });
    return { status: "sent" as const, id: `cem_${sent.length}`, replay: false };
  };

  const human = {
    headers: { "auto-submitted": "no" },
    fromAddress: "customer@acme.test",
    subject: "Where is my order?",
  };

  it("writes a row for every member and emails everyone who has not muted the inbox", async () => {
    sent.length = 0;
    const result = await notifyInboxActivity(
      db,
      {
        kind: "inbox.new_conversation",
        inboxId,
        conversationId,
        subject: "Where is my order?",
        fromName: "A Customer",
        fromAddress: "customer@acme.test",
        preview: "I ordered three weeks ago.",
        message: human,
        actorUserId: null,
      },
      { send }
    );

    expect(result.notified).toBe(3);
    // Linus muted this inbox: he sees it in the bell, but is not emailed.
    expect(result.emailed).toBe(2);
    expect(sent.map((s) => s.id).sort()).toEqual([
      "inbox.new_conversation",
      "inbox.new_conversation",
    ]);
    expect(sent.some((s) => s.to.startsWith(`linus-${suffix}`))).toBe(false);

    const rows = await db
      .select()
      .from(notifications)
      .where(eq(notifications.conversationId, conversationId));
    // Linus's row exists: mute is not the same as hide.
    expect(rows.map((r) => r.userId).sort()).toEqual([ada, grace, linus].sort());
  });

  it("emails nobody twice when the same event is delivered again", async () => {
    sent.length = 0;
    const replay = await notifyInboxActivity(
      db,
      {
        kind: "inbox.new_conversation",
        inboxId,
        conversationId,
        subject: "Where is my order?",
        fromName: "A Customer",
        fromAddress: "customer@acme.test",
        message: human,
      },
      { send }
    );
    expect(replay.notified).toBe(0);
    expect(replay.reason).toBe("already_notified");
    expect(sent).toHaveLength(0);
  });

  it("stays silent for machine mail, even on a brand-new conversation", async () => {
    sent.length = 0;
    const secondConversation = `cnv_inx2_${suffix}`;
    await db.insert(inboxConversations).values({
      id: secondConversation,
      organizationId: orgId,
      projectId,
      inboxId,
      subject: "Out of office",
      threadKey: `tk-inx2-${suffix}`,
      participants: ["robot@acme.test"],
      firstMessageAt: new Date(),
      lastMessageAt: new Date(),
    });

    const result = await notifyInboxActivity(
      db,
      {
        kind: "inbox.new_conversation",
        inboxId,
        conversationId: secondConversation,
        subject: "Out of office",
        fromName: "Robot",
        fromAddress: "robot@acme.test",
        message: {
          headers: { "auto-submitted": "auto-replied" },
          fromAddress: "robot@acme.test",
        },
      },
      { send }
    );

    expect(result.notified).toBe(0);
    expect(result.reason).toBe("auto_submitted");

    const rows = await db
      .select()
      .from(notifications)
      .where(eq(notifications.conversationId, secondConversation));
    expect(rows).toHaveLength(0);
  });

  it("throttles a reply email when the same person was emailed about the thread recently", async () => {
    sent.length = 0;
    const result = await notifyInboxActivity(
      db,
      {
        kind: "inbox.reply_received",
        inboxId,
        conversationId,
        subject: "Where is my order?",
        fromName: "A Customer",
        fromAddress: "customer@acme.test",
        message: human,
        assigneeUserId: grace,
      },
      { send }
    );

    // Grace was emailed the "new conversation" for this thread seconds ago, so
    // the reply reminder is inside the hour: row yes, second email no.
    expect(result.notified).toBe(1);
    expect(result.emailed).toBe(0);
    expect(sent).toHaveLength(0);
  });

  it("emails the assignee for an assignment, skipping the assigner", async () => {
    sent.length = 0;
    const result = await notifyInboxActivity(
      db,
      {
        kind: "inbox.assigned",
        inboxId,
        conversationId,
        subject: "Where is my order?",
        fromName: "A Customer",
        fromAddress: "customer@acme.test",
        assigneeUserId: grace,
        actorUserId: ada,
        assignedByName: "Ada",
      },
      { send }
    );

    expect(result.notified).toBe(1);
    expect(result.emailed).toBe(1);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe(`grace-${suffix}@example.test`);
    expect(sent[0]?.id).toBe("inbox.assigned");
  });
});
