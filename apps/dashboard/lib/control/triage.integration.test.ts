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
 * Support triage (live Postgres).
 *
 * The queue reads seven different tables through seven independent queries, so
 * a renamed column in any one of them fails only that signal. That is the right
 * behaviour at runtime, and exactly the kind of failure a type check cannot
 * catch — hence a live read that insists all seven signals were readable and
 * that the ranking agrees with its own counts.
 */
gate("triage queue (live Postgres)", async () => {
  it("reads every signal and returns a consistent, ranked queue", async () => {
    if (!(await reachable())) return;
    const { triageQueue } = await import("./queries.js");
    const { TRIAGE_SIGNALS } = await import("./triage.js");

    const queue = await triageQueue();

    expect(queue.unreadable).toEqual([]);
    expect(queue.checked).toEqual([...TRIAGE_SIGNALS]);

    expect(queue.counts.total).toBe(queue.items.length);
    expect(queue.counts.critical + queue.counts.high + queue.counts.normal).toBe(
      queue.items.length
    );

    const ids = queue.items.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);

    const rank = { critical: 0, high: 1, normal: 2 } as const;
    for (let i = 1; i < queue.items.length; i += 1) {
      const prev = queue.items[i - 1]!;
      const cur = queue.items[i]!;
      expect(rank[prev.severity]).toBeLessThanOrEqual(rank[cur.severity]);
    }

    for (const item of queue.items) {
      expect(item.href.startsWith("/control/")).toBe(true);
      expect(item.title.length).toBeGreaterThan(0);
      expect(item.detail.length).toBeGreaterThan(0);
      expect(item.organizationName.length).toBeGreaterThan(0);
    }
  });
});

/**
 * The queue is only useful if its joins are right: a renamed column would
 * silently produce an all-quiet page. This seeds one row of every signal,
 * asserts each shows up with the severity the rules promise, and deletes the
 * fixture afterwards (the organization cascade takes the rest with it).
 */
gate("triage queue fixtures (live Postgres)", async () => {
  it("surfaces each seeded problem, then leaves no trace", async () => {
    if (!(await reachable())) return;
    const db = (await import("@calder/db")).getDb();
    const schema = await import("@calder/db");
    const { eq } = await import("drizzle-orm");
    const { triageQueue } = await import("./queries.js");

    const tag = `tri-${Date.now().toString(36)}`;
    const orgId = `org_${tag}`;
    const pausedId = `org_paused_${tag}`;
    const projectId = `prj_${tag}`;
    const domainId = `dom_${tag}`;
    const senderId = `snd_${tag}`;
    const transportId = `trn_${tag}`;
    const webhookId = `whk_${tag}`;

    try {
      await db.insert(schema.organizations).values([
        {
          id: orgId,
          name: `Triage fixture ${tag}`,
          slug: tag,
          deletionRequestedAt: new Date(),
          deletionScheduledFor: new Date(Date.now() + 5 * 86_400_000),
        },
        {
          id: pausedId,
          name: `Paused fixture ${tag}`,
          slug: `${tag}-paused`,
          sendingStatus: "suspended",
          sendingStatusReason: "fixture",
          sendingStatusAt: new Date(Date.now() - 3_600_000),
        },
      ]);
      await db
        .insert(schema.projects)
        .values({ id: projectId, organizationId: orgId, name: "Fixture project", slug: tag });
      await db.insert(schema.domains).values({
        id: domainId,
        projectId,
        domain: `${tag}.example.test`,
        status: "failed",
        lastVerifyError: "no TXT record",
      });
      await db.insert(schema.senderIdentities).values({
        id: senderId,
        projectId,
        displayName: "Fixture sender",
        email: `hello@${tag}.example.test`,
        type: "domain",
        status: "failed",
        statusReason: "domain not verified",
      });
      await db.insert(schema.projectTransports).values({
        id: transportId,
        projectId,
        type: "ses",
        status: "revoked",
        label: `ses-${tag}`,
      });
      // Three failed live sends: the threshold the queue documents.
      await db.insert(schema.emails).values(
        [0, 1, 2].map((n) => ({
          id: `eml_${tag}_${n}`,
          projectId,
          from: `hello@${tag}.example.test`,
          to: `person${n}@recipient.test`,
          subject: "fixture",
          status: "failed" as const,
          env: "live",
        }))
      );
      await db.insert(schema.webhooks).values({
        id: webhookId,
        projectId,
        url: `https://hooks.${tag}.example.test/inbound`,
        secret: "hashed",
        events: ["email.delivered"],
      });
      await db.insert(schema.webhookDeliveries).values({
        id: `whd_${tag}`,
        webhookId,
        projectId,
        event: "email.delivered",
        payload: {},
        status: "exhausted",
        attemptCount: 6,
        lastError: "503 from endpoint",
      });

      const queue = await triageQueue();
      const ids = new Set(queue.items.map((i) => i.id));

      expect(ids.has(`deletion-pending:${orgId}`)).toBe(true);
      expect(ids.has(`workspace-paused:${pausedId}`)).toBe(true);
      expect(ids.has(`domain:${domainId}`)).toBe(true);
      expect(ids.has(`sender-blocked:${senderId}`)).toBe(true);
      expect(ids.has(`transport-revoked:${transportId}`)).toBe(true);
      expect(ids.has(`webhook-exhausted:${webhookId}`)).toBe(true);
      expect(ids.has(`sends-failing:${projectId}`)).toBe(true);

      const paused = queue.items.find((i) => i.id === `workspace-paused:${pausedId}`)!;
      expect(paused.severity).toBe("critical");
      const domain = queue.items.find((i) => i.id === `domain:${domainId}`)!;
      expect(domain.severity).toBe("high");
      expect(domain.href).toContain("status=failed");
      const deletion = queue.items.find((i) => i.id === `deletion-pending:${orgId}`)!;
      expect(deletion.severity).toBe("normal");
      expect(deletion.detail).toContain("5 days");
    } finally {
      await db.delete(schema.organizations).where(eq(schema.organizations.id, orgId));
      await db.delete(schema.organizations).where(eq(schema.organizations.id, pausedId));
    }

    const after = await triageQueue();
    expect(after.items.some((i) => i.id.endsWith(tag))).toBe(false);
    expect(after.items.some((i) => i.organizationName.includes(tag))).toBe(false);
  });
});
