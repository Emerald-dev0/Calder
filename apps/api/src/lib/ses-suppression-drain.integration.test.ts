import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

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
 * What the delivery path does with the provider's suppression answer.
 *
 * Three outcomes, three different behaviours, and all three matter:
 *
 *   suppressed → the row is marked suppressed, credits are returned, and no
 *                provider is ever asked to send it;
 *   clear      → delivery proceeds exactly as before;
 *   unknown    → **nothing is sent**. The row goes back to the queue with a
 *                delay, because an unreachable AWS API must not become a
 *                delivery attempt against a list we could not read, and must
 *                not destroy the customer's mail either.
 */
gate("provider suppression at delivery (live Postgres)", () => {
  const ORIGINAL = { ...process.env };
  const suffix = Math.random().toString(36).slice(2, 8);
  const orgId = `org_sdrn_${suffix}`;
  const projId = `proj_sdrn_${suffix}`;
  const userId = `usr_sdrn_${suffix}`;
  const created: string[] = [];

  beforeAll(async () => {
    if (!(await reachable())) return;
    const { getDb, organizations, organizationMembers, projects, users } =
      await import("@calder/db");
    const db = getDb();
    await db.insert(users).values({ id: userId, email: `sdrn-${suffix}@test.test` });
    await db.insert(organizations).values({ id: orgId, name: "SDRN", slug: `sdrn-${suffix}` });
    await db
      .insert(organizationMembers)
      .values({ id: `orgm_sdrn_${suffix}`, organizationId: orgId, userId, role: "owner" });
    await db.insert(projects).values({ id: projId, organizationId: orgId, name: "P", slug: "p" });

    process.env.AWS_ACCESS_KEY_ID = "test-key";
    process.env.AWS_SECRET_ACCESS_KEY = "test-secret";
  });

  afterEach(async () => {
    const { setSuppressionLookupForTests } = await import("./ses-suppression.js");
    setSuppressionLookupForTests(null);
  });

  afterAll(async () => {
    if (await reachable()) {
      const { getDb, cleanupSuiteOrg } = await import("@calder/db");
      if (created.length > 0) {
        const { emails } = await import("@calder/db");
        const { inArray } = await import("drizzle-orm");
        await getDb().delete(emails).where(inArray(emails.id, created));
      }
      await cleanupSuiteOrg(getDb(), orgId, userId);
    }
    process.env = { ...ORIGINAL };
  });

  async function seedQueued(to: string): Promise<string> {
    const { getDb, emails } = await import("@calder/db");
    const id = `em_sdrn_${Math.random().toString(36).slice(2, 12)}`;
    await getDb()
      .insert(emails)
      .values({
        id,
        projectId: projId,
        from: `sdrn-${suffix}@test.test`,
        to,
        subject: "provider suppression",
        text: "hello",
        status: "queued",
        attemptCount: 0,
        env: "live",
      });
    created.push(id);
    return id;
  }

  it("marks the row suppressed and returns credits when the provider refuses the address", async () => {
    if (!(await reachable())) return;
    const { getDb, emails, emailEvents } = await import("@calder/db");
    const { eq, and } = await import("drizzle-orm");
    const { drainPendingEmails } = await import("./drain.js");
    const { setSuppressionLookupForTests } = await import("./ses-suppression.js");

    const to = `provider-suppressed-${suffix}@example.test`;
    const id = await seedQueued(to);
    setSuppressionLookupForTests(async () => ({
      suppressed: true,
      reason: "BOUNCE",
      lastUpdateTime: new Date(),
    }));

    const result = await drainPendingEmails(getDb());
    expect(result.ok).toBe(true);

    const [row] = await getDb().select().from(emails).where(eq(emails.id, id)).limit(1);
    expect(row?.status).toBe("suppressed");
    expect(row?.lastError).toBe("ses_bounce");

    const [event] = await getDb()
      .select()
      .from(emailEvents)
      .where(and(eq(emailEvents.emailId, id), eq(emailEvents.type, "suppressed")))
      .limit(1);
    expect(event).toBeDefined();
    expect(event?.data).toMatchObject({ reason: "bounce", scope: "account" });

    // Mirrored locally, so the ingest path now refuses the address too.
    const { sesSuppressions } = await import("@calder/db");
    const [mirrored] = await getDb()
      .select()
      .from(sesSuppressions)
      .where(eq(sesSuppressions.email, to))
      .limit(1);
    expect(mirrored?.reason).toBe("BOUNCE");
    expect(mirrored?.source).toBe("delivery");
    await getDb().delete(sesSuppressions).where(eq(sesSuppressions.email, to));
  });

  it("sends nothing when the provider cannot answer, and keeps the mail queued", async () => {
    if (!(await reachable())) return;
    const { getDb, emails } = await import("@calder/db");
    const { eq } = await import("drizzle-orm");
    const { drainPendingEmails } = await import("./drain.js");
    const { setSuppressionLookupForTests } = await import("./ses-suppression.js");

    const id = await seedQueued(`provider-unknown-${suffix}@example.test`);
    setSuppressionLookupForTests(async () => {
      throw new Error("provider API unreachable");
    });

    const before = Date.now();
    const result = await drainPendingEmails(getDb());
    expect(result.ok).toBe(true);
    expect(result.deferred).toBeGreaterThanOrEqual(1);

    const [row] = await getDb().select().from(emails).where(eq(emails.id, id)).limit(1);
    expect(row?.status).toBe("queued");
    expect(row?.lastError).toBe("suppression_check_unavailable");
    expect(row?.nextAttemptAt).toBeInstanceOf(Date);
    expect(row!.nextAttemptAt!.getTime()).toBeGreaterThan(before);
  });
});
