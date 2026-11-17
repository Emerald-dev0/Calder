import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb } from "./client.js";
import * as mod from "./index.js";
import {
  markConversationRead,
  markInboxRead,
  unreadConversationCounts,
  unreadConversationIds,
} from "./inboxes.js";

const gate = process.env.RUN_INTEGRATION_TESTS === "1" ? describe : describe.skip;

/**
 * Unread state for a shared inbox, against real Postgres.
 *
 * "Unread" is the one number a mailbox product must not get wrong: too eager and
 * everyone learns to ignore the badge, too lazy and mail is missed. These tests
 * pin the three rules that make it trustworthy — it is per person, per thread,
 * and never counts work that is finished.
 */
gate("inbox unread state (live Postgres)", () => {
  const db = getDb();
  const suffix = randomUUID().replace(/-/g, "").slice(0, 8);
  const orgId = `org_unr_${suffix}`;
  const projectId = `prj_unr_${suffix}`;
  const ada = `usr_unr_a_${suffix}`;
  const grace = `usr_unr_g_${suffix}`;
  const outsider = `usr_unr_o_${suffix}`;
  const inboxId = `inbx_unr_${suffix}`;
  const otherInboxId = `inbx_unr2_${suffix}`;
  const threadA = `cnv_unr_a_${suffix}`;
  const threadB = `cnv_unr_b_${suffix}`;
  const oldThread = `cnv_unr_old_${suffix}`;
  const closedThread = `cnv_unr_cls_${suffix}`;

  // Fixed, ordered timestamps: the membership exists from June, the mail arrives
  // in July, and "now" (when anything is read) is later still. Using real clock
  // arithmetic here would make the test depend on how fast it runs.
  const JOINED = new Date("2026-06-01T00:00:00Z");
  const ARRIVED_A = new Date("2026-07-01T00:00:00Z");
  const ARRIVED_B = new Date("2026-07-02T00:00:00Z");
  const ARRIVED_CLOSED = new Date("2026-07-03T00:00:00Z");
  const ARRIVED_OTHER = new Date("2026-07-04T00:00:00Z");

  async function insertConversation(id: string, input: { inbox?: string; lastMessageAt: Date }) {
    await db.insert(mod.inboxConversations).values({
      id,
      organizationId: orgId,
      projectId,
      inboxId: input.inbox ?? inboxId,
      subject: `Thread ${id}`,
      threadKey: id,
      participants: ["customer@acme.test"],
      firstMessageAt: input.lastMessageAt,
      lastMessageAt: input.lastMessageAt,
    });
  }

  beforeAll(async () => {
    await db.insert(mod.users).values([
      { id: ada, email: `unr-a-${suffix}@example.test` },
      { id: grace, email: `unr-g-${suffix}@example.test` },
      { id: outsider, email: `unr-o-${suffix}@example.test` },
    ]);
    await db
      .insert(mod.organizations)
      .values({ id: orgId, name: `Unread ${suffix}`, slug: `unread-${suffix}` });
    await db
      .insert(mod.projects)
      .values({ id: projectId, organizationId: orgId, name: "Unread", slug: `unread-p-${suffix}` });

    // History that predates anybody joining.
    await db.insert(mod.inboxes).values([
      { id: inboxId, organizationId: orgId, projectId, name: "Support", slug: `sup-${suffix}` },
      { id: otherInboxId, organizationId: orgId, projectId, name: "Sales", slug: `sal-${suffix}` },
    ]);
    await insertConversation(oldThread, { lastMessageAt: new Date("2025-01-01T00:00:00Z") });
  });

  afterAll(async () => {
    await db.delete(mod.organizations).where(eq(mod.organizations.id, orgId));
    await db.delete(mod.users).where(eq(mod.users.id, ada));
    await db.delete(mod.users).where(eq(mod.users.id, grace));
    await db.delete(mod.users).where(eq(mod.users.id, outsider));
  });

  it("does not hand a brand-new member the entire history as unread", async () => {
    await db.insert(mod.inboxMembers).values({
      id: `imb_unr_a_${suffix}`,
      inboxId,
      userId: ada,
      role: "manager",
      createdAt: JOINED,
    });
    // The thread existed before the membership row, so nobody is waiting on it.
    expect((await unreadConversationCounts(db, { userId: ada })).total).toBe(0);

    // Mail that arrives after joining does count.
    await insertConversation(threadA, { lastMessageAt: ARRIVED_A });
    const after = await unreadConversationCounts(db, { userId: ada });
    expect(after.total).toBe(1);
    expect(after.perInbox).toEqual([{ inboxId, unread: 1 }]);
  });

  it("clears one thread without clearing the inbox", async () => {
    await insertConversation(threadB, { lastMessageAt: ARRIVED_B });
    expect((await unreadConversationCounts(db, { userId: ada })).total).toBe(2);

    await markConversationRead(db, { conversationId: threadA, userId: ada });

    const remaining = await unreadConversationCounts(db, { userId: ada });
    expect(remaining.total).toBe(1);
    expect(remaining.perInbox).toEqual([{ inboxId, unread: 1 }]);

    // The list dots come from the same rule, so they must agree with the badge.
    const ids = await unreadConversationIds(db, { userId: ada, inboxId });
    expect([...ids]).toEqual([threadB]);
  });

  it("is monotone: re-opening an old tab cannot make a thread unread again", async () => {
    await markConversationRead(db, { conversationId: threadB, userId: ada });
    expect((await unreadConversationCounts(db, { userId: ada })).total).toBe(0);

    await markConversationRead(db, {
      conversationId: threadB,
      userId: ada,
      at: new Date("2020-01-01T00:00:00Z"),
    });
    expect((await unreadConversationCounts(db, { userId: ada })).total).toBe(0);
  });

  it("keeps one person's reading out of another person's badge", async () => {
    await db.insert(mod.inboxMembers).values({
      id: `imb_unr_g_${suffix}`,
      inboxId,
      userId: grace,
      role: "member",
      // Grace never read anything here, so her baseline is when she joined.
      createdAt: JOINED,
      lastReadAt: new Date("2020-01-01T00:00:00Z"),
    });

    const graceCount = await unreadConversationCounts(db, { userId: grace });
    expect(graceCount.total).toBe(3); // the old thread, A and B

    // Ada read two of them; her badge stays at zero.
    expect((await unreadConversationCounts(db, { userId: ada })).total).toBe(0);
  });

  it("clears the whole inbox when someone marks it read", async () => {
    await markInboxRead(db, { inboxId, userId: grace });
    expect((await unreadConversationCounts(db, { userId: grace })).total).toBe(0);
  });

  it("never counts a closed conversation, and never counts an inbox you are not in", async () => {
    await db.insert(mod.inboxConversations).values({
      id: closedThread,
      organizationId: orgId,
      projectId,
      inboxId,
      subject: "Done",
      threadKey: closedThread,
      participants: ["customer@acme.test"],
      status: "closed",
      firstMessageAt: ARRIVED_CLOSED,
      lastMessageAt: ARRIVED_CLOSED,
    });

    const counts = await unreadConversationCounts(db, { userId: grace });
    expect(counts.total).toBe(0);
    expect((await unreadConversationIds(db, { userId: grace, inboxId })).size).toBe(0);

    // A conversation in a mailbox Ada is not a member of must not appear.
    await insertConversation(`cnv_unr_x_${suffix}`, {
      inbox: otherInboxId,
      lastMessageAt: ARRIVED_OTHER,
    });
    expect((await unreadConversationCounts(db, { userId: ada })).total).toBe(0);
    expect((await unreadConversationCounts(db, { userId: outsider })).total).toBe(0);
  });
});
