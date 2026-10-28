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
 * Sender attribution at the API boundary.
 *
 * A `from` address with no sender identity is accepted today and must keep
 * being accepted: rejecting it would break every caller sending from a bare
 * address, which is most of the legacy integrations. What it must not be is
 * invisible. The row carries `sender_identity_id = NULL`, the acceptance
 * response says `attributed: false`, and an `unattributed` event is written in
 * the same transaction as the message.
 *
 * The second test is the other half of the same contract: a registered address
 * is attributed and writes no such event, so the marker means what it says
 * instead of appearing on every send.
 */
gate("sender attribution on POST /v1/emails (live Postgres)", async () => {
  const { randomBytes } = await import("node:crypto");
  const {
    getDb,
    organizations,
    organizationMembers,
    projects,
    users,
    emails,
    emailEvents,
    senderIdentities,
    cleanupSuiteOrg,
  } = await import("@calder/db");
  const { and, eq } = await import("drizzle-orm");
  const { createApp } = await import("../app.js");
  const { registerDevKey } = await import("../middleware/auth.js");

  const suffix = randomBytes(4).toString("hex");
  const orgId = `org_att_${suffix}`;
  const projId = `proj_att_${suffix}`;
  const userId = `usr_att_${suffix}`;
  const senderId = `sender_att_${suffix}`;
  const keySecret = `calder_test_att_${suffix}_${"k".repeat(12)}`;
  const registeredFrom = `att-${suffix}@att.test`;

  const app = createApp();
  const post = (from: string, to: string) =>
    app.request("/v1/emails", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${keySecret}`,
      },
      body: JSON.stringify({ from, to, subject: "attribution", text: "hello" }),
    });

  /** Events of a type for one email id. */
  const eventsFor = async (emailId: string, type: string) => {
    const db = getDb();
    return db
      .select({ id: emailEvents.id, data: emailEvents.data })
      .from(emailEvents)
      .where(and(eq(emailEvents.emailId, emailId), eq(emailEvents.type, type as never)));
  };

  beforeAll(async () => {
    if (!(await reachable())) return;
    const db = getDb();
    await db.insert(users).values({ id: userId, email: `att-user-${suffix}@test.test` });
    await db
      .insert(organizations)
      .values({ id: orgId, name: "Attribution", slug: `att-${suffix}` });
    await db
      .insert(organizationMembers)
      .values({ id: `orgm_att_${suffix}`, organizationId: orgId, userId, role: "owner" });
    await db.insert(projects).values({ id: projId, organizationId: orgId, name: "P", slug: "p" });
    // A verified identity: the attributed side of the contract needs a real
    // sender row, not a mock.
    await db.insert(senderIdentities).values({
      id: senderId,
      projectId: projId,
      email: registeredFrom,
      displayName: "Attribution Test",
      type: "domain",
      status: "verified",
    });
    registerDevKey(keySecret, {
      apiKeyId: `key_att_${suffix}`,
      projectId: projId,
      organizationId: orgId,
      env: "test",
    });
  });

  afterAll(async () => {
    if (!(await reachable())) return;
    await cleanupSuiteOrg(getDb(), orgId, userId);
  });

  it("accepts an unregistered From, says it is unattributed, and records the event", async () => {
    if (!(await reachable())) return;
    const res = await post(`stranger-${suffix}@elsewhere.test`, `to-${suffix}@example.test`);
    expect(res.status).toBe(202);

    const body = (await res.json()) as {
      id: string;
      status: string;
      message: string;
      sender: {
        id: string | null;
        email: string;
        display_name: string | null;
        attributed: boolean;
      };
    };
    // Every pre-existing field survives: this is additive.
    expect(body).toMatchObject({ status: "queued", message: expect.any(String) });
    expect(body.id).toMatch(/^em_/);
    expect(body.sender).toEqual({
      id: null,
      email: `stranger-${suffix}@elsewhere.test`,
      display_name: null,
      attributed: false,
    });

    const db = getDb();
    const [row] = await db.select().from(emails).where(eq(emails.id, body.id)).limit(1);
    expect(row?.senderIdentityId).toBeNull();
    // The address was kept exactly as the caller sent it.
    expect(row?.from).toBe(`stranger-${suffix}@elsewhere.test`);

    const unattributed = await eventsFor(body.id, "unattributed");
    expect(unattributed).toHaveLength(1);
    expect(unattributed[0]?.data).toEqual({ reason: "no_sender_identity_for_from" });
    // The queued event still exists: the marker is an addition, not a swap.
    expect(await eventsFor(body.id, "queued")).toHaveLength(1);
  });

  it("attributes a registered From and records no unattributed event", async () => {
    if (!(await reachable())) return;
    const body = await post(registeredFrom, `to-${suffix}@example.test`);
    expect(body.status).toBe(202);
    const payload = (await body.json()) as {
      id: string;
      sender: { id: string | null; attributed: boolean; display_name: string | null };
    };
    expect(payload.sender.attributed).toBe(true);
    expect(payload.sender.id).toBe(senderId);
    expect(payload.sender.display_name).toBe("Attribution Test");

    const db = getDb();
    const [row] = await db.select().from(emails).where(eq(emails.id, payload.id)).limit(1);
    expect(row?.senderIdentityId).toBe(senderId);

    expect(await eventsFor(payload.id, "unattributed")).toHaveLength(0);
    expect(await eventsFor(payload.id, "queued")).toHaveLength(1);
  });

  it("keeps the attribution on an idempotent replay", async () => {
    if (!(await reachable())) return;
    const key = `att-replay-${suffix}`;
    const send = () =>
      app.request("/v1/emails", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${keySecret}`,
          "idempotency-key": key,
        },
        body: JSON.stringify({
          from: `replay-${suffix}@elsewhere.test`,
          to: `to-${suffix}@example.test`,
          subject: "replay",
          text: "hello",
        }),
      });
    const first = (await (await send()).json()) as {
      id: string;
      sender: { attributed: boolean };
    };
    expect(first.sender.attributed).toBe(false);

    const replay = await send();
    expect(replay.status).toBe(200);
    const stored = (await replay.json()) as { id: string; sender: { attributed: boolean } };
    // The stored body carries the attribution, so a replay never answers a
    // different question than the original request did.
    expect(stored.id).toBe(first.id);
    expect(stored.sender.attributed).toBe(false);
  });
});
