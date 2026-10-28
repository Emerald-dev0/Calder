import { describe, it, expect, beforeAll, afterAll } from "vitest";

// Gate: needs a live Postgres (scripts/dev-infra.mjs). Skipped otherwise.
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
 * The arithmetic this workspace could not explain.
 *
 * A stream said 5 sent; the only sender identity said 4. Both were correct:
 * `senderHealth` groups by `sender_identity_id` and skips the null group, while
 * the stream cards count every accepted row. The missing term — messages no
 * identity owns — is what the senders page now names out loud.
 *
 * Also covers the two measurements behind "is 0 delivered believable":
 * when SES last reported back, and how many messages were accepted since.
 */
gate("sender attribution arithmetic (live Postgres)", async () => {
  const { randomBytes, randomUUID } = await import("node:crypto");
  const {
    getDb,
    organizations,
    organizationMembers,
    projects,
    users,
    senderIdentities,
    emails,
    emailEvents,
    deliveryEventIngress,
    cleanupSuiteOrg,
  } = await import("@calder/db");
  const { eq } = await import("drizzle-orm");
  const svc = await import("./service");

  const suffix = randomBytes(4).toString("hex");
  const orgId = `org_att_${suffix}`;
  const projectId = `proj_att_${suffix}`;
  const userId = `usr_att_${suffix}`;
  const senderId = `sender_att_${suffix}`;

  const newId = () => `em_${randomUUID().replace(/-/g, "").slice(0, 20)}`;

  beforeAll(async () => {
    if (!(await reachable())) return;
    const db = getDb();
    await db.insert(users).values({ id: userId, email: `att-${suffix}@test.test` });
    await db
      .insert(organizations)
      .values({ id: orgId, name: "Attribution", slug: `att-${suffix}` });
    await db
      .insert(organizationMembers)
      .values({ id: `orgm_att_${suffix}`, organizationId: orgId, userId, role: "owner" });
    await db
      .insert(projects)
      .values({ id: projectId, organizationId: orgId, name: "P", slug: "p" });
    await db.insert(senderIdentities).values({
      id: senderId,
      projectId,
      displayName: "Registered Sender",
      email: `hello@att-${suffix}.test`,
      type: "domain",
      status: "verified",
    });
  });

  afterAll(async () => {
    if (!(await reachable())) return;
    await cleanupSuiteOrg(getDb(), orgId, userId);
  });

  it("adds the unattributed term back so the total equals the stream", async () => {
    if (!(await reachable())) return;
    const db = getDb();
    const attributedId = newId();
    const unattributedId = newId();
    const base = {
      projectId,
      env: "live" as const,
      from: `hello@att-${suffix}.test`,
      subject: "one",
      text: "hello",
      status: "sent" as const,
    };
    await db.insert(emails).values([
      { ...base, id: attributedId, to: `a-${suffix}@test.test`, senderIdentityId: senderId },
      // The row that used to vanish from the page's arithmetic: accepted, but
      // its From matched no registered identity.
      { ...base, id: unattributedId, to: `b-${suffix}@test.test`, senderIdentityId: null },
    ]);

    const [stats, health, unattributed] = await Promise.all([
      svc.streamStats(projectId),
      svc.senderHealth(projectId),
      svc.unattributedSends(projectId),
    ]);

    const streamTotal = stats.transactional.sent + stats.marketing.sent;
    const attributedTotal = [...health.values()].reduce((sum, h) => sum + h.sent7d, 0);

    expect(streamTotal).toBe(2);
    expect(attributedTotal).toBe(1);
    expect(unattributed).toBe(1);
    // The whole point: the page can now show a sum that closes.
    expect(attributedTotal + unattributed).toBe(streamTotal);
  });

  it("counts only accepted statuses as unattributed volume", async () => {
    if (!(await reachable())) return;
    const db = getDb();
    // Queued and failed rows are not "sent without a sender"; they were never
    // sent at all.
    await db.insert(emails).values([
      {
        id: newId(),
        projectId,
        env: "live",
        from: `hello@att-${suffix}.test`,
        to: `q-${suffix}@test.test`,
        subject: "queued",
        text: "x",
        status: "queued",
        senderIdentityId: null,
      },
      {
        id: newId(),
        projectId,
        env: "live",
        from: `hello@att-${suffix}.test`,
        to: `f-${suffix}@test.test`,
        subject: "failed",
        text: "x",
        status: "failed",
        senderIdentityId: null,
      },
    ]);
    expect(await svc.unattributedSends(projectId)).toBe(1);
  });

  it("measures delivery-event ingress: none, then one, per project", async () => {
    if (!(await reachable())) return;
    const db = getDb();
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const before = await deliveryEventIngress(db, { projectId, since });
    expect(before.lastDeliveryEventAt).toBeNull();
    expect(before.acceptedInWindow).toBe(2);

    const [first] = await db
      .select({ id: emails.id })
      .from(emails)
      .where(eq(emails.projectId, projectId))
      .limit(1);
    await db.insert(emailEvents).values({
      id: `ev_${randomUUID().replace(/-/g, "").slice(0, 20)}`,
      emailId: first!.id,
      projectId,
      type: "delivered",
      data: { source: "ses-feedback" },
    });

    const after = await deliveryEventIngress(db, { projectId, since });
    expect(after.lastDeliveryEventAt).toBeInstanceOf(Date);
  });

  it("turns those facts into the sentence the cards show", async () => {
    if (!(await reachable())) return;
    const saved = process.env.SES_SNS_TOPIC_ARNS;

    // Unconfigured ingress: the zeros on the cards are not measurements.
    delete process.env.SES_SNS_TOPIC_ARNS;
    const unconfigured = await svc.deliveryEventHealth(projectId);
    expect(unconfigured.zerosTrusted).toBe(false);
    expect(unconfigured.state).toBe("unconfigured");

    // Configured, and an event landed: a zero would be real.
    process.env.SES_SNS_TOPIC_ARNS = "arn:aws:sns:us-east-1:000000000000:calder-feedback";
    const fresh = await svc.deliveryEventHealth(projectId);
    expect(fresh.state).toBe("fresh");
    expect(fresh.zerosTrusted).toBe(true);

    if (saved === undefined) delete process.env.SES_SNS_TOPIC_ARNS;
    else process.env.SES_SNS_TOPIC_ARNS = saved;
  });
});
