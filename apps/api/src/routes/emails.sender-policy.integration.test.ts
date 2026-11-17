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
 * Who a live send is allowed to say it is from (Stage 3.3).
 *
 * A bare `from` with no sender identity used to be accepted and recorded as
 * unattributed. That made "send from anything" the live default: the provider
 * only checks the domain, so a project could send as any mailbox at a domain it
 * owns, and a customer could not tell which of their addresses produced a
 * message. Now a live send must resolve to a verified sender identity, with one
 * exception a project grants itself: a bare address at a domain it verified.
 */
gate("sender authorization on live sends (live Postgres)", async () => {
  const { randomBytes } = await import("node:crypto");
  const {
    getDb,
    organizations,
    organizationMembers,
    projects,
    users,
    domains,
    emails,
    emailEvents,
    cleanupSuiteOrg,
  } = await import("@calder/db");
  const { and, eq, count } = await import("drizzle-orm");
  const { createApp } = await import("../app.js");
  const { registerDevKey } = await import("../middleware/auth.js");

  const suffix = randomBytes(4).toString("hex");
  const orgId = `org_sndp_${suffix}`;
  const projId = `proj_sndp_${suffix}`;
  const userId = `usr_sndp_${suffix}`;
  const domainName = `sndp-${suffix}.test`;
  const liveKey = `calder_sk_live_sndp_${suffix}_${"k".repeat(12)}`;
  const testKey = `calder_test_sndp_${suffix}_${"k".repeat(12)}`;

  const app = createApp();
  const send = (key: string, from: string, to = `to-${suffix}@example.test`) =>
    app.request("/v1/emails", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({ from, to, subject: "sender policy", text: "hello" }),
    });

  beforeAll(async () => {
    if (!(await reachable())) return;
    const db = getDb();
    await db.insert(users).values({ id: userId, email: `sndp-${suffix}@test.test` });
    await db
      .insert(organizations)
      .values({ id: orgId, name: "Sender Policy", slug: `sndp-${suffix}` });
    await db
      .insert(organizationMembers)
      .values({ id: `orgm_sndp_${suffix}`, organizationId: orgId, userId, role: "owner" });
    await db.insert(projects).values({ id: projId, organizationId: orgId, name: "P", slug: "p" });
    // The domain is verified: the customer owns it. That is not, by itself,
    // permission to send from arbitrary mailboxes on it.
    await db.insert(domains).values({
      id: `dom_sndp_${suffix}`,
      projectId: projId,
      domain: domainName,
      status: "verified",
      verifiedAt: new Date(),
    });
    registerDevKey(liveKey, {
      apiKeyId: `key_sndp_live_${suffix}`,
      projectId: projId,
      organizationId: orgId,
      env: "live",
    });
    registerDevKey(testKey, {
      apiKeyId: `key_sndp_test_${suffix}`,
      projectId: projId,
      organizationId: orgId,
      env: "test",
    });
  });

  afterAll(async () => {
    if (!(await reachable())) return;
    const db = getDb();
    await db.update(projects).set({ metadata: {} }).where(eq(projects.id, projId));
    await cleanupSuiteOrg(db, orgId, userId);
  });

  it("refuses a live send from an unknown address, pointing at Senders", async () => {
    if (!(await reachable())) return;
    const db = getDb();
    const res = await send(liveKey, `stranger-${suffix}@${domainName}`);
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("sender_not_ready");
    expect(body.error.message).toContain("Senders");
    expect(body.error.message).toContain("stranger-");

    // Refused before persistence: no row, no event, nothing to drain.
    const rows = await db
      .select({ value: count() })
      .from(emails)
      .where(eq(emails.projectId, projId));
    expect(Number(rows[0]?.value ?? 0)).toBe(0);
  });

  it("refuses an address at a domain the project has not verified, even when the domain is someone else's", async () => {
    if (!(await reachable())) return;
    const res = await send(liveKey, `ceo-${suffix}@elsewhere.test`);
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("sender_not_ready");
  });

  it("still accepts a raw address in test mode, where the provider is mocked", async () => {
    if (!(await reachable())) return;
    const res = await send(testKey, `anything-${suffix}@whatever.test`);
    expect(res.status).toBe(202);
    const body = (await res.json()) as { sender: { attributed: boolean } };
    expect(body.sender.attributed).toBe(false);
  });

  it("accepts a raw address at a verified domain once the project opts in", async () => {
    if (!(await reachable())) return;
    const db = getDb();
    await db
      .update(projects)
      .set({ metadata: { allowUnattributedSenders: true } })
      .where(eq(projects.id, projId));

    const address = `billing-${suffix}@${domainName}`;
    const res = await send(liveKey, address);
    expect(res.status).toBe(202);
    const body = (await res.json()) as {
      id: string;
      sender: { attributed: boolean; email: string };
    };
    expect(body.sender.attributed).toBe(false);
    expect(body.sender.email).toBe(address);

    // Still visible as unattributed, so the Senders page can explain the gap.
    const [event] = await db
      .select()
      .from(emailEvents)
      .where(and(eq(emailEvents.emailId, body.id), eq(emailEvents.type, "unattributed")))
      .limit(1);
    expect(event).toBeDefined();

    // The opt-in is scoped to verified domains: another domain is still out.
    const other = await send(liveKey, `billing-${suffix}@not-ours.test`);
    expect(other.status).toBe(422);
  });

  it("keeps naming Senders after the opt-in, for addresses it does not cover", async () => {
    if (!(await reachable())) return;
    const res = await send(liveKey, `other-${suffix}@not-ours.test`);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toContain("Senders");
  });
});
