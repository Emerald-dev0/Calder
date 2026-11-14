import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { getDb } from "./client.js";
import * as mod from "./index.js";
import {
  emailsSentSince,
  lastEmailedForConversation,
  listNotifications,
  markConversationNotificationsRead,
  markNotificationsEmailed,
  markNotificationsRead,
  pushNotifications,
  unreadConversationCounts,
  unreadNotificationCount,
  type NewNotification,
} from "./notifications.js";

const gate = process.env.RUN_INTEGRATION_TESTS === "1" ? describe : describe.skip;

/**
 * The notification ledger against a real database.
 *
 * The assertions that matter are structural: the unique index — not application
 * code — is what stops a redelivered SNS notification from emailing somebody
 * twice, so it is tested by inserting the same thing twice and watching the
 * second insert vanish.
 */
gate("notifications (live Postgres)", () => {
  const db = getDb();
  const suffix = randomUUID().replace(/-/g, "").slice(0, 8);
  const orgId = `org_ntf_${suffix}`;
  const projectId = `prj_ntf_${suffix}`;
  const userId = `usr_ntf_${suffix}`;
  const otherUserId = `usr_ntf2_${suffix}`;
  const inboxId = `inbx_ntf_${suffix}`;
  const conversationId = `cnv_ntf_${suffix}`;
  const otherConversationId = `cnv_ntf2_${suffix}`;

  function row(overrides: Partial<NewNotification> = {}): NewNotification {
    const base: NewNotification = {
      id: `ntf_${randomUUID().replace(/-/g, "").slice(0, 22)}`,
      userId,
      organizationId: orgId,
      projectId,
      kind: "inbox.new_conversation",
      inboxId,
      conversationId,
      title: "New in Support: Hello",
      body: "Hi there",
      href: `/inbox/${conversationId}`,
    };
    const merged = { ...base, ...overrides };
    // The href follows the conversation, as the dispatcher's does.
    if (overrides.href === undefined) {
      merged.href = merged.conversationId ? `/inbox/${merged.conversationId}` : "/inbox";
    }
    return merged;
  }

  beforeAll(async () => {
    await db.insert(mod.users).values([
      { id: userId, email: `ntf-${suffix}@example.test` },
      { id: otherUserId, email: `ntf2-${suffix}@example.test` },
    ]);
    await db
      .insert(mod.organizations)
      .values({ id: orgId, name: `Notify ${suffix}`, slug: `notify-${suffix}` });
    await db
      .insert(mod.projects)
      .values({ id: projectId, organizationId: orgId, name: "Notify", slug: `notify-p-${suffix}` });
    await db.insert(mod.inboxes).values({
      id: inboxId,
      organizationId: orgId,
      projectId,
      name: "Support",
      slug: `support-ntf-${suffix}`,
    });
    await db.insert(mod.inboxConversations).values([
      {
        id: conversationId,
        organizationId: orgId,
        projectId,
        inboxId,
        subject: "Hello",
        threadKey: `tk-${suffix}-1`,
        participants: ["customer@acme.test"],
        firstMessageAt: new Date(),
        lastMessageAt: new Date(),
      },
      {
        id: otherConversationId,
        organizationId: orgId,
        projectId,
        inboxId,
        subject: "Second",
        threadKey: `tk-${suffix}-2`,
        participants: ["customer@acme.test"],
        firstMessageAt: new Date(),
        lastMessageAt: new Date(),
      },
    ]);
  });

  afterAll(async () => {
    await db.delete(mod.organizations).where(eq(mod.organizations.id, orgId));
    await db.delete(mod.users).where(eq(mod.users.id, userId));
    await db.delete(mod.users).where(eq(mod.users.id, otherUserId));
  });

  it("keeps one row per person, conversation and kind", async () => {
    const first = await pushNotifications(db, [row()]);
    expect(first).toHaveLength(1);

    // A redelivered SNS notification, or a retried ingest, produces the same
    // event again — and must not produce a second row or a second email.
    const replay = await pushNotifications(db, [row({ id: row().id })]);
    expect(replay).toHaveLength(0);

    // A different kind for the same conversation is a genuinely different fact.
    const assigned = await pushNotifications(db, [row({ kind: "inbox.assigned" })]);
    expect(assigned).toHaveLength(1);

    // So is the same kind for a different conversation.
    const otherThread = await pushNotifications(db, [row({ conversationId: otherConversationId })]);
    expect(otherThread).toHaveLength(1);
  });

  it("counts unread rows and clears them for one conversation only", async () => {
    const before = await unreadNotificationCount(db, userId);
    expect(before).toBeGreaterThanOrEqual(3);

    const cleared = await markConversationNotificationsRead(db, {
      userId,
      conversationId,
    });
    expect(cleared).toBe(2);

    const remaining = await unreadNotificationCount(db, userId);
    expect(remaining).toBe(before - 2);

    // Clearing twice is a no-op rather than an error: opening a page twice is
    // not a mistake worth reporting.
    expect(await markConversationNotificationsRead(db, { userId, conversationId })).toBe(0);
  });

  it("never marks another person's notifications read", async () => {
    const [theirs] = await pushNotifications(db, [
      row({ userId: otherUserId, conversationId: null }),
    ]);
    expect(theirs).toBeDefined();

    // The row is visible in the response, so a hostile client can name it. The
    // user filter is what stops the write, not the obscurity of the id.
    const marked = await markNotificationsRead(db, { userId, ids: [theirs!.id] });
    expect(marked).toBe(0);
    expect(await unreadNotificationCount(db, otherUserId)).toBe(1);
  });

  it("scopes the feed to the caller", async () => {
    const mine = await listNotifications(db, { userId: otherUserId });
    expect(mine).toHaveLength(1);
    expect(mine[0]?.userId).toBe(otherUserId);
    expect(mine[0]?.href).toBe("/inbox");
  });

  it("records email sends so caps and throttles have something to read", async () => {
    const [notification] = await pushNotifications(db, [
      row({ conversationId: otherConversationId, kind: "inbox.reply_received" }),
    ]);
    expect(notification).toBeDefined();

    const now = new Date();
    expect(await emailsSentSince(db, { userId, since: new Date(now.getTime() - 3_600_000) })).toBe(
      0
    );
    expect(
      await lastEmailedForConversation(db, { userId, conversationId: otherConversationId })
    ).toBeNull();

    await markNotificationsEmailed(db, [notification!.id], now);

    expect(await emailsSentSince(db, { userId, since: new Date(now.getTime() - 3_600_000) })).toBe(
      1
    );
    const last = await lastEmailedForConversation(db, {
      userId,
      conversationId: otherConversationId,
    });
    expect(last?.getTime()).toBe(now.getTime());

    // Older than the window: the hourly cap forgets it, the throttle still sees it.
    expect(await emailsSentSince(db, { userId, since: new Date(now.getTime() + 1) })).toBe(0);
  });

  it("counts unread conversations per inbox from the member's last read", async () => {
    const seenLater = new Date(Date.now() + 60_000);
    await db.insert(mod.inboxMembers).values({
      id: `imb_cnt_${suffix}`,
      inboxId,
      userId: otherUserId,
      role: "member",
      // Read before the conversations moved, so both are unread.
      lastReadAt: new Date("2020-01-01T00:00:00Z"),
    });

    const unread = await unreadConversationCounts(db, { userId: otherUserId });
    expect(unread.total).toBe(2);
    expect(unread.perInbox).toEqual([{ inboxId, unread: 2 }]);

    // Catching up on the inbox clears the badge...
    await db
      .update(mod.inboxMembers)
      .set({ lastReadAt: seenLater })
      .where(and(eq(mod.inboxMembers.inboxId, inboxId), eq(mod.inboxMembers.userId, otherUserId)));
    expect((await unreadConversationCounts(db, { userId: otherUserId })).total).toBe(0);

    // ...but a closed thread is never "waiting for you", even if it moved after.
    await db
      .update(mod.inboxConversations)
      .set({ status: "closed", lastMessageAt: new Date(Date.now() + 120_000) })
      .where(eq(mod.inboxConversations.id, conversationId));
    expect((await unreadConversationCounts(db, { userId: otherUserId })).total).toBe(0);

    // Somebody with no mailbox sees nothing at all.
    expect((await unreadConversationCounts(db, { userId })).total).toBe(0);
  });

  it("defaults a new inbox member to receiving email", async () => {
    const [member] = await db
      .insert(mod.inboxMembers)
      .values({ id: `imb_ntf_${suffix}`, inboxId, userId, role: "member" })
      .returning({ notify: mod.inboxMembers.notify });
    expect(member?.notify).toBe(true);

    await db
      .update(mod.inboxMembers)
      .set({ notify: false })
      .where(and(eq(mod.inboxMembers.inboxId, inboxId), eq(mod.inboxMembers.userId, userId)));
  });
});
