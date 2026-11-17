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
 * Acknowledgement round trip (live Postgres).
 *
 * The rules themselves are unit-tested; what this checks is that the ones the
 * page depends on survive a real database: an acknowledgement removes an item
 * from the open queue, new evidence brings it straight back, the cooldown
 * lapses on its own, and an explicit reopen wins over all of it. Each of those
 * is a promise the copy on the page makes, and each is a query.
 */
gate("support acknowledgements (live Postgres)", async () => {
  it("hides, reopens and lapses exactly as the page claims", async () => {
    if (!(await reachable())) return;
    const db = (await import("@calder/db")).getDb();
    const schema = await import("@calder/db");
    const { eq } = await import("drizzle-orm");
    const { triageQueue } = await import("./queries.js");
    const { fingerprintOf } = await import("./acknowledgements.js");

    const tag = `ack-${Date.now().toString(36)}`;
    const orgId = `org_${tag}`;
    const projectId = `prj_${tag}`;
    const domainId = `dom_${tag}`;
    const ackId = `ack_${tag}`;

    const seed = async () => {
      await db.insert(schema.organizations).values({
        id: orgId,
        name: `Ack fixture ${tag}`,
        slug: tag,
      });
      await db.insert(schema.projects).values({
        id: projectId,
        organizationId: orgId,
        name: "Fixture",
        slug: tag,
      });
      await db.insert(schema.domains).values({
        id: domainId,
        projectId,
        domain: `${tag}.example.test`,
        status: "failed",
      });
    };

    try {
      await seed();

      // 1. Open before anything is acknowledged.
      const before = await triageQueue();
      const item = before.items.find((i) => i.id === `domain:${domainId}`);
      expect(item).toBeDefined();
      expect(before.acknowledged.some((a) => a.item.id === `domain:${domainId}`)).toBe(false);

      const fingerprint = fingerprintOf(item!);
      await db.insert(schema.triageAcknowledgements).values({
        id: ackId,
        itemId: `domain:${domainId}`,
        kind: item!.kind,
        title: item!.title,
        fingerprint,
        note: "customer emailed support",
        acknowledgedByUserId: null,
      });

      // 2. Acknowledged: out of the open queue, still visible as acknowledged.
      const acked = await triageQueue();
      expect(acked.items.some((i) => i.id === `domain:${domainId}`)).toBe(false);
      const entry = acked.acknowledged.find((a) => a.item.id === `domain:${domainId}`);
      expect(entry).toBeDefined();
      expect(entry!.ack.note).toBe("customer emailed support");
      expect(acked.counts.total).toBe(acked.items.length);
      expect(acked.acknowledgementCount).toBeGreaterThanOrEqual(1);

      // 3. New evidence reopens without waiting for the cooldown.
      await db
        .update(schema.triageAcknowledgements)
        .set({ fingerprint: "0".repeat(32) })
        .where(eq(schema.triageAcknowledgements.id, ackId));
      const changed = await triageQueue();
      expect(changed.items.some((i) => i.id === `domain:${domainId}`)).toBe(true);
      expect(changed.acknowledged.some((a) => a.item.id === `domain:${domainId}`)).toBe(false);

      // 4. A matching acknowledgement whose cooldown has passed also reopens.
      await db
        .update(schema.triageAcknowledgements)
        .set({ fingerprint, acknowledgedAt: new Date(Date.now() - 25 * 3_600_000) })
        .where(eq(schema.triageAcknowledgements.id, ackId));
      const expired = await triageQueue();
      expect(expired.items.some((i) => i.id === `domain:${domainId}`)).toBe(true);

      // 5. An explicit reopen wins even inside the cooldown.
      await db
        .update(schema.triageAcknowledgements)
        .set({ acknowledgedAt: new Date(), reopenedAt: new Date() })
        .where(eq(schema.triageAcknowledgements.id, ackId));
      const reopened = await triageQueue();
      expect(reopened.items.some((i) => i.id === `domain:${domainId}`)).toBe(true);
      expect(reopened.acknowledged.some((a) => a.item.id === `domain:${domainId}`)).toBe(false);
    } finally {
      await db
        .delete(schema.triageAcknowledgements)
        .where(eq(schema.triageAcknowledgements.id, ackId));
      await db.delete(schema.organizations).where(eq(schema.organizations.id, orgId));
    }

    const after = await triageQueue();
    expect(after.items.some((i) => i.organizationName.includes(tag))).toBe(false);
    expect(after.acknowledged.some((a) => a.item.organizationName.includes(tag))).toBe(false);
  });
});
