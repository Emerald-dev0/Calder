import { describe, it, expect } from "vitest";

// Gate: needs a live Postgres (local docker). CI-safe skip otherwise.
process.env.RUN_INTEGRATION_TESTS ??= "";
const ENABLED = process.env.RUN_INTEGRATION_TESTS === "1";

const gate = ENABLED ? describe : describe.skip;

async function reachable(): Promise<boolean> {
  try {
    const { getDb } = await import("@calder/db");
    const { sql } = await import("drizzle-orm");
    await getDb().execute(sql`select 1`);
    return true;
  } catch {
    return false;
  }
}

/**
 * Inbound overview (live Postgres).
 *
 * The page reads six tables in one go (domains, messages, inboxes, projects,
 * organisations, and the counts beside them). A renamed column breaks only that
 * query, and an empty result would look exactly like "no mail has ever
 * arrived" — so this seeds one of everything and checks the page's claims hold:
 * totals agree with their parts, a verified-but-unprovisioned domain is
 * detectable, and a failed message is in the failure list with its reason.
 */
gate("inbound overview (live Postgres)", async () => {
  it("reads domains, messages and inboxes without inventing any of them", async () => {
    if (!(await reachable())) return;
    const db = (await import("@calder/db")).getDb();
    const schema = await import("@calder/db");
    const { eq } = await import("drizzle-orm");
    const { inboundOverview } = await import("./queries.js");

    const tag = `inb-${Date.now().toString(36)}`;
    const orgId = `org_${tag}`;
    const projectId = `prj_${tag}`;
    const domainId = `rcd_${tag}`;
    const inboxId = `inbx_${tag}`;

    try {
      await db.insert(schema.organizations).values({
        id: orgId,
        name: `Inbound fixture ${tag}`,
        slug: tag,
      });
      await db.insert(schema.projects).values({
        id: projectId,
        organizationId: orgId,
        name: "Fixture",
        slug: tag,
      });
      await db.insert(schema.receivingDomains).values({
        id: domainId,
        projectId,
        domain: `${tag}.example.test`,
        status: "verified",
        verificationToken: `tok_${tag}`,
        mxHost: "inbound.calder.test",
        mxPriority: 10,
        verifiedAt: new Date(),
        lastCheckedAt: new Date(),
        // Deliberately no provisionedAt: the page must be able to say
        // "verified but no receipt rule recorded".
      });
      await db.insert(schema.inboxes).values({
        id: inboxId,
        organizationId: orgId,
        projectId,
        name: "Support",
        slug: "support",
      });
      await db.insert(schema.inboundMessages).values([
        {
          id: `inb_${tag}_1`,
          organizationId: orgId,
          projectId,
          receivingDomainId: domainId,
          recipientDomain: `${tag}.example.test`,
          sesMessageId: `ses_${tag}_1`,
          fromAddress: "customer@example.com",
          subject: "Where is my invoice?",
          status: "routed",
          inboxId,
          receivedAt: new Date(),
        },
        {
          id: `inb_${tag}_2`,
          organizationId: orgId,
          projectId,
          receivingDomainId: domainId,
          recipientDomain: `${tag}.example.test`,
          sesMessageId: `ses_${tag}_2`,
          fromAddress: "customer@example.com",
          subject: "Parsed but unrouted",
          status: "parsed",
          receivedAt: new Date(),
        },
        {
          id: `inb_${tag}_3`,
          organizationId: orgId,
          projectId,
          receivingDomainId: domainId,
          recipientDomain: `${tag}.example.test`,
          sesMessageId: `ses_${tag}_3`,
          fromAddress: "customer@example.com",
          subject: "Broken MIME",
          status: "failed",
          failureReason: "multipart boundary missing",
          receivedAt: new Date(),
        },
      ]);

      const inbound = await inboundOverview(30);

      // Totals agree with their parts.
      const c = inbound.counts;
      expect(inbound.total).toBe(c.received + c.parsed + c.routed + c.failed + c.rejected);
      expect(inbound.total).toBeGreaterThanOrEqual(3);

      // The domain is listed, with the provisioning gap visible to the page.
      const row = inbound.domainRows.find((d) => d.id === domainId);
      expect(row).toBeDefined();
      expect(row!.status).toBe("verified");
      expect(row!.provisionedAt).toBeNull();
      expect(row!.organizationName).toContain(tag);

      // The failure is listed with its reason, and rates are real percentages.
      const failure = inbound.failures.find((m) => m.id === `inb_${tag}_3`);
      expect(failure).toBeDefined();
      expect(failure!.failureReason).toBe("multipart boundary missing");
      expect(inbound.parseFailureRate).not.toBeNull();
      expect(inbound.parseFailureRate!).toBeGreaterThan(0);
      expect(inbound.parseFailureRate!).toBeLessThanOrEqual(100);

      // Domain counts partition the total.
      const d = inbound.domains;
      expect(d.total).toBe(d.verified + d.pending + d.verifying + d.failed + d.disabled);

      // The routed message carries its inbox name; the unassigned one does not.
      const routed = inbound.recent.find((m) => m.id === `inb_${tag}_1`);
      expect(routed?.inboxName).toBe("Support");
      const unassigned = inbound.recent.find((m) => m.id === `inb_${tag}_2`);
      expect(unassigned?.inboxName).toBeNull();
    } finally {
      await db.delete(schema.organizations).where(eq(schema.organizations.id, orgId));
    }

    const after = await inboundOverview(30);
    expect(after.domainRows.some((d) => d.id === domainId)).toBe(false);
    expect(after.recent.some((m) => m.organizationId === orgId)).toBe(false);
  });
});
