import { describe, it, expect, beforeAll, afterAll } from "vitest";

// Gate: needs a live Postgres (local docker). CI-safe skip otherwise.
process.env.RUN_INTEGRATION_TESTS ??= "";
const ENABLED = process.env.RUN_INTEGRATION_TESTS === "1";

const gate = ENABLED ? describe : describe.skip;

async function reachable(): Promise<boolean> {
  try {
    const { getDb } = await import("@calder/db");
    const { sql } = await import("drizzle-orm");
    const db = getDb();
    await db.execute(sql`select 1`);
    return true;
  } catch {
    return false;
  }
}

/**
 * Phase 0, M0.1 ingest correctness, end to end through the HTTP app:
 * - concurrent same-Idempotency-Key sends produce exactly ONE queued email
 * - a completed key replays the stored response (200, same id)
 * - a suppressed recipient is rejected at ingest (4xx with the reason)
 */
gate("POST /v1/emails ingest correctness (live Postgres)", async () => {
  const { randomBytes } = await import("node:crypto");
  const { getDb, organizations, organizationMembers, projects, users, emails, emailEvents } =
    await import("@calder/db");
  const { eq, and, count } = await import("drizzle-orm");
  const { createApp } = await import("../app.js");
  const { registerDevKey } = await import("../middleware/auth.js");

  const suffix = randomBytes(4).toString("hex");
  const orgId = `org_ing_${suffix}`;
  const projId = `proj_ing_${suffix}`;
  const userId = `usr_ing_${suffix}`;
  const keySecret = `calder_test_ing_${suffix}_${"k".repeat(12)}`;

  const app = createApp();
  const post = (body: unknown, key?: string) =>
    app.request("/v1/emails", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${keySecret}`,
        ...(key ? { "idempotency-key": key } : {}),
      },
      body: JSON.stringify(body),
    });

  const sendBody = (to: string) => ({
    from: `ing-${suffix}@test.test`,
    to,
    subject: "ingest test",
    text: "hello",
  });

  beforeAll(async () => {
    if (!(await reachable())) return;
    const db = getDb();
    await db.insert(users).values({ id: userId, email: `ing-user-${suffix}@test.test` });
    await db
      .insert(organizations)
      .values({ id: orgId, name: "Ingest Test", slug: `ing-${suffix}` });
    await db
      .insert(organizationMembers)
      .values({ id: `orgm_ing_${suffix}`, organizationId: orgId, userId, role: "owner" });
    await db.insert(projects).values({ id: projId, organizationId: orgId, name: "P", slug: "p" });
    registerDevKey(keySecret, {
      apiKeyId: `key_ing_${suffix}`,
      projectId: projId,
      organizationId: orgId,
      env: "test",
    });
  });

  afterAll(async () => {
    if (!(await reachable())) return;
    const db = getDb();
    // Deleting the org cascades to projects, emails, events, suppressions,
    // idempotency-key rows and membership.
    await db.delete(organizations).where(eq(organizations.id, orgId));
    await db.delete(users).where(eq(users.id, userId));
  });

  it("concurrent same-key sends produce exactly one queued email and one replay set", async () => {
    if (!(await reachable())) return;
    const key = `idem-conc-${suffix}`;
    const N = 8;
    const responses = await Promise.all(
      Array.from({ length: N }, () => post(sendBody(`conc-${suffix}@example.test`), key))
    );
    const statuses = responses.map((r) => r.status);
    const accepted = responses.filter((_, i) => statuses[i] === 202);
    const replays = responses.filter((_, i) => statuses[i] === 200);
    const conflicts = responses.filter((_, i) => statuses[i] === 409);

    // Exactly one request wins; the rest replay or (rarely) conflict.
    expect(accepted.length).toBe(1);
    expect(accepted.length + conflicts.length).toBe(1);
    expect(replays.length + conflicts.length).toBe(N - 1);

    const winnerBody = (await accepted[0]!.json()) as { id: string; status: string };
    for (const replay of replays) {
      const body = (await replay.json()) as { id: string };
      expect(body.id).toBe(winnerBody.id);
    }

    // Durable state: exactly one email row + one queued event for the key.
    const db = getDb();
    const [emailRows] = await db
      .select({ value: count() })
      .from(emails)
      .where(and(eq(emails.projectId, projId), eq(emails.idempotencyKey, key)));
    expect(emailRows?.value).toBe(1);
    const [eventRows] = await db
      .select({ value: count() })
      .from(emailEvents)
      .where(
        and(
          eq(emailEvents.projectId, projId),
          eq(emailEvents.emailId, winnerBody.id),
          eq(emailEvents.type, "queued")
        )
      );
    expect(eventRows?.value).toBe(1);
  });

  it("sequential same-key send replays the stored response (200, same id)", async () => {
    if (!(await reachable())) return;
    const key = `idem-seq-${suffix}`;
    const first = await post(sendBody(`seq-${suffix}@example.test`), key);
    expect(first.status).toBe(202);
    const firstBody = (await first.json()) as { id: string; status: string };

    const second = await post(sendBody(`seq-${suffix}@example.test`), key);
    expect(second.status).toBe(200);
    const secondBody = (await second.json()) as { id: string; status: string };
    expect(secondBody.id).toBe(firstBody.id);
    expect(secondBody.status).toBe("queued");

    // Still exactly one durable email row.
    const db = getDb();
    const [rows] = await db
      .select({ value: count() })
      .from(emails)
      .where(and(eq(emails.projectId, projId), eq(emails.idempotencyKey, key)));
    expect(rows?.value).toBe(1);
  });

  it("a suppressed recipient is rejected at ingest with a reason (4xx)", async () => {
    if (!(await reachable())) return;
    const db = getDb();
    const { suppressions } = await import("@calder/db");
    await db.insert(suppressions).values({
      id: `sup_ing_${suffix}`,
      projectId: projId,
      email: `blocked-${suffix}@example.test`,
      reason: "bounce",
    });

    const res = await post(sendBody(`blocked-${suffix}@example.test`), `idem-sup-${suffix}`);
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("suppressed");
    expect(body.error.message).toContain("bounce");

    // Nothing was persisted or queued for the rejected send.
    const [rows] = await db
      .select({ value: count() })
      .from(emails)
      .where(and(eq(emails.projectId, projId), eq(emails.to, `blocked-${suffix}@example.test`)));
    expect(rows?.value).toBe(0);
  });
});
