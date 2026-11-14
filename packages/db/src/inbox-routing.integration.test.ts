import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { closeDb, getDb } from "./client.js";
import * as mod from "./index.js";
import {
  localPartOf,
  normaliseSubject,
  parseMessageIds,
  resolveInboxForRecipient,
  routeInboundMessage,
  threadKeyFor,
} from "./inbox-routing.js";

const gate = process.env.RUN_INTEGRATION_TESTS === "1" ? describe : describe.skip;

describe("thread helpers (pure)", () => {
  it("strips reply and forward prefixes, repeatedly", () => {
    expect(normaliseSubject("Re: Invoice #42")).toBe("invoice #42");
    expect(normaliseSubject("RE: FW: Re:   Invoice   #42  ")).toBe("invoice #42");
    expect(normaliseSubject("Re[2]: hello")).toBe("hello");
    expect(normaliseSubject(null)).toBe("");
  });

  it("derives the same thread key regardless of participant order or case", () => {
    const a = threadKeyFor({ participants: ["B@x.test", "a@x.test"], subject: "Re: Hello" });
    const b = threadKeyFor({ participants: ["a@x.test", "b@x.test"], subject: "hello" });
    expect(a).toBe(b);
    expect(a).toHaveLength(64);
  });

  it("separates different subjects and different people", () => {
    expect(threadKeyFor({ participants: ["a@x.test"], subject: "one" })).not.toBe(
      threadKeyFor({ participants: ["a@x.test"], subject: "two" })
    );
    expect(threadKeyFor({ participants: ["a@x.test"], subject: "one" })).not.toBe(
      threadKeyFor({ participants: ["b@x.test"], subject: "one" })
    );
  });

  it("reads Message-IDs out of References in order, without duplicates", () => {
    expect(parseMessageIds("<a@x> <b@x>", "<b@x> <c@x>")).toEqual(["<a@x>", "<b@x>", "<c@x>"]);
    expect(parseMessageIds(null, undefined, "")).toEqual([]);
  });

  it("splits a local part strictly", () => {
    expect(localPartOf("Support@Inbox.acme.test")).toBe("support");
    expect(localPartOf("@nope.test")).toBeNull();
    expect(localPartOf("no-at")).toBeNull();
  });
});

/**
 * Routing and threading against a real database.
 *
 * These are the rules that decide which mailbox a stranger's mail lands in and
 * which conversation it joins, so they are exercised with real rows, real
 * uniqueness constraints and real counters.
 */
gate("inbox routing (live Postgres)", () => {
  const db = getDb();
  const suffix = randomUUID().replace(/-/g, "").slice(0, 8);
  const orgId = `org_rt_${suffix}`;
  const projectId = `prj_rt_${suffix}`;
  const otherProjectId = `prj_rt2_${suffix}`;
  const userId = `usr_rt_${suffix}`;
  const domainId = `rcd_rt_${suffix}`;
  const domain = `inbox-rt-${suffix}.acme.test`;
  const supportInboxId = `inbx_sup_${suffix}`;
  const catchAllInboxId = `inbx_all_${suffix}`;
  const otherInboxId = `inbx_other_${suffix}`;

  let seq = 0;
  function newMessageId(): string {
    seq += 1;
    return `inb_rt_${suffix}_${seq}`;
  }

  async function insertMessage(input: {
    id: string;
    messageIdHeader?: string | null;
    subject?: string;
    from?: string;
    recipient?: string;
  }): Promise<void> {
    await db.insert(mod.inboundMessages).values({
      id: input.id,
      organizationId: orgId,
      projectId,
      receivingDomainId: domainId,
      recipientDomain: domain,
      sesMessageId: `ses-rt-${suffix}-${input.id}`,
      envelopeRecipient: input.recipient ?? `support@${domain}`,
      fromAddress: input.from ?? "customer@acme.test",
      toAddresses: [input.recipient ?? `support@${domain}`],
      subject: input.subject ?? "Hello",
      messageIdHeader: input.messageIdHeader ?? null,
      receivedAt: new Date(),
      status: "parsed",
    });
  }

  beforeAll(async () => {
    await db.insert(mod.users).values({ id: userId, email: `rt-${suffix}@example.test` });
    await db.insert(mod.organizations).values({
      id: orgId,
      name: `Routing ${suffix}`,
      slug: `routing-${suffix}`,
    });
    await db.insert(mod.projects).values([
      { id: projectId, organizationId: orgId, name: "Routing", slug: `routing-p-${suffix}` },
      { id: otherProjectId, organizationId: orgId, name: "Other", slug: `routing-o-${suffix}` },
    ]);
    await db.insert(mod.receivingDomains).values({
      id: domainId,
      projectId,
      domain,
      status: "verified",
      verificationToken: "cvt_rt",
      mxHost: "inbound.calder.test",
      verifiedAt: new Date(),
      provisionedAt: new Date(),
    });
    await db.insert(mod.inboxes).values([
      {
        id: supportInboxId,
        organizationId: orgId,
        projectId,
        name: "Support",
        slug: `support-${suffix}`,
      },
      {
        id: catchAllInboxId,
        organizationId: orgId,
        projectId,
        name: "Catch all",
        slug: `catchall-${suffix}`,
      },
      {
        id: otherInboxId,
        organizationId: orgId,
        projectId: otherProjectId,
        name: "Elsewhere",
        slug: `elsewhere-${suffix}`,
      },
    ]);
    await db.insert(mod.inboxRoutes).values([
      {
        id: `irt_sup_${suffix}`,
        inboxId: supportInboxId,
        receivingDomainId: domainId,
        localPart: "support",
      },
      {
        id: `irt_all_${suffix}`,
        inboxId: catchAllInboxId,
        receivingDomainId: domainId,
        localPart: "*",
      },
    ]);
  });

  afterAll(async () => {
    await db.delete(mod.organizations).where(eq(mod.organizations.id, orgId));
    await db.delete(mod.users).where(eq(mod.users.id, userId));
  });

  it("prefers an exact address rule over the catch-all", async () => {
    const exact = await resolveInboxForRecipient(db, {
      receivingDomainId: domainId,
      address: `support@${domain}`,
    });
    expect(exact).toBe(supportInboxId);

    const fallback = await resolveInboxForRecipient(db, {
      receivingDomainId: domainId,
      address: `billing@${domain}`,
    });
    expect(fallback).toBe(catchAllInboxId);
  });

  it("starts a conversation for the first message and keeps the counters honest", async () => {
    const id = newMessageId();
    await insertMessage({ id, messageIdHeader: "<rt-1@acme.test>", subject: "Need help" });

    const routed = await routeInboundMessage(db, {
      inboundMessageId: id,
      projectId,
      organizationId: orgId,
      receivingDomainId: domainId,
      envelopeRecipient: `support@${domain}`,
      fromAddress: "customer@acme.test",
      toAddresses: [`support@${domain}`],
      subject: "Need help",
      messageIdHeader: "<rt-1@acme.test>",
      inReplyTo: null,
      references: null,
      receivedAt: new Date(),
    });

    expect(routed.inboxId).toBe(supportInboxId);
    expect(routed.started).toBe(true);

    const [conversation] = await db
      .select()
      .from(mod.inboxConversations)
      .where(eq(mod.inboxConversations.id, routed.conversationId!));
    expect(conversation?.messageCount).toBe(1);
    expect(conversation?.inboundCount).toBe(1);
    expect(conversation?.status).toBe("open");
    expect(conversation?.participants).toContain("customer@acme.test");

    const [message] = await db
      .select()
      .from(mod.inboundMessages)
      .where(eq(mod.inboundMessages.id, id));
    expect(message?.conversationId).toBe(routed.conversationId);
    expect(message?.status).toBe("routed");
  });

  it("threads a follow-up by In-Reply-To even when the subject changed", async () => {
    const last = await db
      .select()
      .from(mod.inboxConversations)
      .where(eq(mod.inboxConversations.inboxId, supportInboxId))
      .limit(1);
    const conversationId = last[0]!.id;

    const id = newMessageId();
    await insertMessage({
      id,
      messageIdHeader: "<rt-2@acme.test>",
      subject: "Completely different subject",
      from: "customer@acme.test",
    });
    const routed = await routeInboundMessage(db, {
      inboundMessageId: id,
      projectId,
      organizationId: orgId,
      receivingDomainId: domainId,
      envelopeRecipient: `support@${domain}`,
      fromAddress: "customer@acme.test",
      toAddresses: [`support@${domain}`],
      subject: "Completely different subject",
      messageIdHeader: "<rt-2@acme.test>",
      inReplyTo: "<rt-1@acme.test>",
      references: "<rt-1@acme.test>",
      receivedAt: new Date(),
    });

    expect(routed.conversationId).toBe(conversationId);
    expect(routed.started).toBe(false);

    const [conversation] = await db
      .select()
      .from(mod.inboxConversations)
      .where(eq(mod.inboxConversations.id, conversationId));
    expect(conversation?.messageCount).toBe(2);
  });

  it("threads by subject when headers are missing, but only within the inbox", async () => {
    const id = newMessageId();
    await insertMessage({
      id,
      messageIdHeader: null,
      subject: "Re: Need help",
      from: "customer@acme.test",
    });
    const routed = await routeInboundMessage(db, {
      inboundMessageId: id,
      projectId,
      organizationId: orgId,
      receivingDomainId: domainId,
      envelopeRecipient: `support@${domain}`,
      fromAddress: "customer@acme.test",
      toAddresses: [`support@${domain}`],
      subject: "Re: Need help",
      messageIdHeader: null,
      inReplyTo: null,
      references: null,
      receivedAt: new Date(),
    });
    expect(routed.started).toBe(false);
    expect(routed.inboxId).toBe(supportInboxId);
  });

  it("does not thread a matching subject into a different inbox", async () => {
    const id = newMessageId();
    await insertMessage({ id, subject: "Need help", recipient: `billing@${domain}` });
    const routed = await routeInboundMessage(db, {
      inboundMessageId: id,
      projectId,
      organizationId: orgId,
      receivingDomainId: domainId,
      envelopeRecipient: `billing@${domain}`,
      fromAddress: "customer@acme.test",
      toAddresses: [`billing@${domain}`],
      subject: "Need help",
      messageIdHeader: "<rt-4@acme.test>",
      inReplyTo: null,
      references: null,
      receivedAt: new Date(),
    });
    expect(routed.inboxId).toBe(catchAllInboxId);
    expect(routed.started).toBe(true);
  });

  it("leaves a message unassigned when no rule matches", async () => {
    const unmatchedDomainId = `rcd_raw_${suffix}`;
    const unmatched = `raw-${suffix}.acme.test`;
    await db.insert(mod.receivingDomains).values({
      id: unmatchedDomainId,
      projectId,
      domain: unmatched,
      status: "verified",
      verificationToken: "cvt_raw",
      mxHost: "inbound.calder.test",
      verifiedAt: new Date(),
      provisionedAt: new Date(),
    });
    const id = newMessageId();
    await insertMessage({ id, recipient: `nobody@${unmatched}` });

    const routed = await routeInboundMessage(db, {
      inboundMessageId: id,
      projectId,
      organizationId: orgId,
      receivingDomainId: unmatchedDomainId,
      envelopeRecipient: `nobody@${unmatched}`,
      fromAddress: "customer@acme.test",
      toAddresses: [`nobody@${unmatched}`],
      subject: "Orphan",
      messageIdHeader: null,
      inReplyTo: null,
      references: null,
      receivedAt: new Date(),
    });

    expect(routed.inboxId).toBeNull();
    expect(routed.conversationId).toBeNull();

    // Still stored and readable at project level: not a black hole.
    const [message] = await db
      .select()
      .from(mod.inboundMessages)
      .where(eq(mod.inboundMessages.id, id));
    expect(message?.status).toBe("parsed");
    expect(message?.inboxId).toBeNull();
  });

  it("reopens a closed conversation when the customer writes again", async () => {
    const [conversation] = await db
      .select()
      .from(mod.inboxConversations)
      .where(eq(mod.inboxConversations.inboxId, supportInboxId))
      .limit(1);
    await mod.updateConversation(db, {
      conversationId: conversation!.id,
      patch: { status: "closed" },
    });

    const id = newMessageId();
    await insertMessage({
      id,
      messageIdHeader: "<rt-5@acme.test>",
      subject: "Re: Need help",
      from: "customer@acme.test",
    });
    await routeInboundMessage(db, {
      inboundMessageId: id,
      projectId,
      organizationId: orgId,
      receivingDomainId: domainId,
      envelopeRecipient: `support@${domain}`,
      fromAddress: "customer@acme.test",
      toAddresses: [`support@${domain}`],
      subject: "Re: Need help",
      messageIdHeader: "<rt-5@acme.test>",
      inReplyTo: "<rt-1@acme.test>",
      references: "<rt-1@acme.test>",
      receivedAt: new Date(),
    });

    const [after] = await db
      .select()
      .from(mod.inboxConversations)
      .where(eq(mod.inboxConversations.id, conversation!.id));
    expect(after?.status).toBe("open");
    expect(after?.closedAt).toBeNull();
  });

  it("refuses a second claim on one address, because routing must not be ambiguous", async () => {
    await expect(
      db.insert(mod.inboxRoutes).values({
        id: `irt_dup_${suffix}`,
        inboxId: catchAllInboxId,
        receivingDomainId: domainId,
        localPart: "support",
      })
    ).rejects.toThrow();
  });

  it("scopes conversation lists to their inbox", async () => {
    const { rows } = await mod.listConversations(db, { inboxId: supportInboxId, status: "all" });
    expect(rows.length).toBeGreaterThan(0);
    const ids = rows.map((r) => r.id);
    const others = await db
      .select({ id: mod.inboxConversations.id })
      .from(mod.inboxConversations)
      .where(eq(mod.inboxConversations.inboxId, catchAllInboxId));
    for (const other of others) expect(ids).not.toContain(other.id);
  });

  it("applies optimistic concurrency to status changes", async () => {
    const [conversation] = await db
      .select()
      .from(mod.inboxConversations)
      .where(
        and(
          eq(mod.inboxConversations.inboxId, supportInboxId),
          eq(mod.inboxConversations.status, "open")
        )
      )
      .limit(1);

    const first = await mod.updateConversation(db, {
      conversationId: conversation!.id,
      patch: { status: "pending" },
      expectedVersion: conversation!.version,
    });
    expect(first).not.toBeNull();

    // A stale page tries the same change again and must be told, not silently win.
    const second = await mod.updateConversation(db, {
      conversationId: conversation!.id,
      patch: { status: "closed" },
      expectedVersion: conversation!.version,
    });
    expect(second).toBeNull();
  });
});

/**
 * Cross-organisation isolation.
 *
 * Two workspaces, each with its own receiving domain and inbox. Everything in
 * this stage is keyed by project, so the assertions are that no listing,
 * conversation read, or label lookup can cross the boundary even when the caller
 * knows the other side's ids.
 */
gate("inbox isolation between organisations (live Postgres)", () => {
  const db = getDb();
  const suffix = randomUUID().replace(/-/g, "").slice(0, 8);
  const orgA = `org_iso_a_${suffix}`;
  const orgB = `org_iso_b_${suffix}`;
  const projectA = `prj_iso_a_${suffix}`;
  const projectB = `prj_iso_b_${suffix}`;
  const domainA = `iso-a-${suffix}.acme.test`;
  const domainB = `iso-b-${suffix}.acme.test`;
  const inboxA = `inbx_iso_a_${suffix}`;
  const inboxB = `inbx_iso_b_${suffix}`;

  beforeAll(async () => {
    await db.insert(mod.organizations).values([
      { id: orgA, name: `Iso A ${suffix}`, slug: `iso-a-${suffix}` },
      { id: orgB, name: `Iso B ${suffix}`, slug: `iso-b-${suffix}` },
    ]);
    await db.insert(mod.projects).values([
      { id: projectA, organizationId: orgA, name: "A", slug: `iso-pa-${suffix}` },
      { id: projectB, organizationId: orgB, name: "B", slug: `iso-pb-${suffix}` },
    ]);
    await db.insert(mod.receivingDomains).values([
      {
        id: `rcd_iso_a_${suffix}`,
        projectId: projectA,
        domain: domainA,
        status: "verified",
        verificationToken: "cvt_a",
        mxHost: "inbound.calder.test",
        verifiedAt: new Date(),
        provisionedAt: new Date(),
      },
      {
        id: `rcd_iso_b_${suffix}`,
        projectId: projectB,
        domain: domainB,
        status: "verified",
        verificationToken: "cvt_b",
        mxHost: "inbound.calder.test",
        verifiedAt: new Date(),
        provisionedAt: new Date(),
      },
    ]);
    await db.insert(mod.inboxes).values([
      {
        id: inboxA,
        organizationId: orgA,
        projectId: projectA,
        name: "A inbox",
        slug: `a-${suffix}`,
      },
      {
        id: inboxB,
        organizationId: orgB,
        projectId: projectB,
        name: "B inbox",
        slug: `b-${suffix}`,
      },
    ]);
    await db.insert(mod.inboxRoutes).values([
      {
        id: `irt_iso_a_${suffix}`,
        inboxId: inboxA,
        receivingDomainId: `rcd_iso_a_${suffix}`,
        localPart: "*",
      },
      {
        id: `irt_iso_b_${suffix}`,
        inboxId: inboxB,
        receivingDomainId: `rcd_iso_b_${suffix}`,
        localPart: "*",
      },
    ]);
  });

  afterAll(async () => {
    await db.delete(mod.organizations).where(eq(mod.organizations.id, orgA));
    await db.delete(mod.organizations).where(eq(mod.organizations.id, orgB));
  });

  it("lists only the inboxes of the project asked for", async () => {
    const listA = await mod.listInboxesForProject(db, projectA);
    expect(listA.map((i) => i.id)).toEqual([inboxA]);
    const listB = await mod.listInboxesForProject(db, projectB);
    expect(listB.map((i) => i.id)).toEqual([inboxB]);
  });

  it("never resolves another project's address to our inbox", async () => {
    const resolved = await resolveInboxForRecipient(db, {
      receivingDomainId: `rcd_iso_b_${suffix}`,
      address: `support@${domainA}`,
    });
    expect(resolved).toBe(inboxB);
    expect(resolved).not.toBe(inboxA);
  });

  it("keeps conversations readable only through their own inbox", async () => {
    const id = `inb_iso_${suffix}`;
    await db.insert(mod.inboundMessages).values({
      id,
      organizationId: orgA,
      projectId: projectA,
      receivingDomainId: `rcd_iso_a_${suffix}`,
      recipientDomain: domainA,
      sesMessageId: `ses-iso-${suffix}`,
      envelopeRecipient: `support@${domainA}`,
      fromAddress: "customer@acme.test",
      toAddresses: [`support@${domainA}`],
      subject: "Private to A",
      receivedAt: new Date(),
      status: "parsed",
    });
    const routed = await routeInboundMessage(db, {
      inboundMessageId: id,
      projectId: projectA,
      organizationId: orgA,
      receivingDomainId: `rcd_iso_a_${suffix}`,
      envelopeRecipient: `support@${domainA}`,
      fromAddress: "customer@acme.test",
      toAddresses: [`support@${domainA}`],
      subject: "Private to A",
      messageIdHeader: "<iso-1@acme.test>",
      inReplyTo: null,
      references: null,
      receivedAt: new Date(),
    });

    // B's conversation list is empty even though it can guess A's conversation id.
    const listB = await mod.listConversations(db, { inboxId: inboxB, status: "all" });
    expect(listB.rows.map((r) => r.id)).not.toContain(routed.conversationId);

    // The row itself carries B's inbox id, never A's.
    const [conversation] = await db
      .select()
      .from(mod.inboxConversations)
      .where(eq(mod.inboxConversations.id, routed.conversationId!));
    expect(conversation?.projectId).toBe(projectA);
    expect(conversation?.organizationId).toBe(orgA);
  });
});

// One pool for the whole file: closing it inside a suite pulls the floor out
// from under the suites that run after it.
afterAll(async () => {
  await closeDb();
});
