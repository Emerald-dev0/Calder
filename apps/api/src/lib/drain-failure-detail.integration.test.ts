import { describe, it, expect, beforeAll, afterAll } from "vitest";

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
 * What a failed delivery leaves behind.
 *
 * The row used to keep only `provider_error` — a class, not a cause — and its
 * `transport` column stayed null, which the dashboard rendered as an em dash
 * that reads as "nothing was routed". These assertions pin the replacement:
 * the leg that was tried and the error's class are persisted, the provider's
 * message is not.
 */
gate("failed delivery detail (live Postgres)", async () => {
  const { randomBytes, randomUUID } = await import("node:crypto");
  const {
    getDb,
    organizations,
    organizationMembers,
    projects,
    users,
    emails,
    emailEvents,
    cleanupSuiteOrg,
  } = await import("@calder/db");
  const { and, eq } = await import("drizzle-orm");
  const { drainPendingEmails } = await import("./drain.js");

  const suffix = randomBytes(4).toString("hex");
  const orgId = `org_fdl_${suffix}`;
  const projId = `proj_fdl_${suffix}`;
  const userId = `usr_fdl_${suffix}`;

  beforeAll(async () => {
    if (!(await reachable())) return;
    const db = getDb();
    await db.insert(users).values({ id: userId, email: `fdl-user-${suffix}@test.test` });
    await db
      .insert(organizations)
      .values({ id: orgId, name: "Failure Detail", slug: `fdl-${suffix}` });
    await db
      .insert(organizationMembers)
      .values({ id: `orgm_fdl_${suffix}`, organizationId: orgId, userId, role: "owner" });
    await db.insert(projects).values({ id: projId, organizationId: orgId, name: "P", slug: "p" });
  });

  afterAll(async () => {
    if (!(await reachable())) return;
    await cleanupSuiteOrg(getDb(), orgId, userId);
  });

  it("records the leg and the error class, never the provider's message", async () => {
    if (!(await reachable())) return;
    const db = getDb();
    const emailId = `em_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
    // A recipient the mock provider refuses, so the delivery genuinely fails.
    // The thrown message embeds this address, which is exactly the text that
    // must not end up in a stored event.
    const badRecipient = `not-an-address-${suffix}`;
    await db.insert(emails).values({
      id: emailId,
      projectId: projId,
      env: "live",
      from: `fdl-${suffix}@test.test`,
      to: badRecipient,
      subject: "failure detail",
      text: "hello",
      status: "queued",
      attemptCount: 0,
    });

    await drainPendingEmails();

    const [row] = await db.select().from(emails).where(eq(emails.id, emailId)).limit(1);
    expect(row?.status).toBe("failed");
    // Nothing delivered it, so the transport column stays null rather than
    // naming a leg that never got the message out.
    expect(row?.transport ?? null).toBeNull();

    const [event] = await db
      .select()
      .from(emailEvents)
      .where(and(eq(emailEvents.emailId, emailId), eq(emailEvents.type, "failed")))
      .limit(1);
    expect(event).toBeTruthy();
    const data = event!.data as Record<string, unknown>;
    // The provider's verdict survives as a code (InvalidRecipient is on the
    // allowlist), alongside the leg that produced it.
    expect(data.code).toBe("InvalidRecipient");
    expect(data.leg).toBe("default");
    expect(data.legs).toEqual(["default"]);
    expect(typeof data.errorName).toBe("string");

    // The message — and therefore the address inside it — is not stored.
    const serialised = JSON.stringify(data);
    expect(serialised).not.toContain(badRecipient);
    expect(serialised).not.toContain("Invalid recipient");
  });

  it("falls back to provider_error plus the class when nothing is allowlisted", async () => {
    if (!(await reachable())) return;
    const { deliveryFailureDetail } = await import("@calder/observability");
    // Same shape the drain writes, for the case CI cannot provoke through a
    // real provider here: an unclassified throw from our own code.
    expect(deliveryFailureDetail(new TypeError("x is undefined"), "default")).toEqual({
      code: "provider_error",
      leg: "default",
      errorName: "TypeError",
    });
  });
});
