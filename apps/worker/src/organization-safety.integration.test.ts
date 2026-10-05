import { afterAll, beforeAll, describe, expect, it } from "vitest";

process.env.RUN_INTEGRATION_TESTS ??= "";
const gate = process.env.RUN_INTEGRATION_TESTS === "1" ? describe : describe.skip;

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

gate("worker rechecks organization safety before provider delivery", async () => {
  const { randomBytes } = await import("node:crypto");
  const {
    getDb,
    users,
    organizations,
    organizationMembers,
    projects,
    emails,
    emailEvents,
    usageRecords,
    cleanupSuiteOrg,
  } = await import("@calder/db");
  const { and, eq, count } = await import("drizzle-orm");
  const { processEmailJob } = await import("./worker.js");

  const suffix = randomBytes(4).toString("hex");
  const orgId = `org_worker_gate_${suffix}`;
  const userId = `usr_worker_gate_${suffix}`;
  const projectId = `proj_worker_gate_${suffix}`;
  const emailId = `em_worker_gate_${suffix}`;

  beforeAll(async () => {
    if (!(await reachable())) return;
    const db = getDb();
    await db.insert(users).values({ id: userId, email: `worker-gate-${suffix}@test.test` });
    await db.insert(organizations).values({
      id: orgId,
      name: "Worker safety test",
      slug: `worker-gate-${suffix}`,
      sendingStatus: "suspended",
      sendingStatusReason: "integration test",
      sendingStatusAt: new Date(),
    });
    await db.insert(organizationMembers).values({
      id: `orgm_worker_gate_${suffix}`,
      organizationId: orgId,
      userId,
      role: "owner",
    });
    await db.insert(projects).values({
      id: projectId,
      organizationId: orgId,
      name: "Worker gate",
      slug: "worker-gate",
    });
    await db.insert(emails).values({
      id: emailId,
      projectId,
      from: `worker-${suffix}@example.test`,
      to: `recipient-${suffix}@example.test`,
      subject: "blocked queued test email",
      text: "A suspended org must not reach even the mock provider.",
      env: "test",
      status: "queued",
    });
  });

  afterAll(async () => {
    if (!(await reachable())) return;
    await cleanupSuiteOrg(getDb(), orgId, userId);
  });

  it("fails a queued test row without provider delivery or usage metering", async () => {
    if (!(await reachable())) return;
    const outcome = await processEmailJob({
      id: `job_worker_gate_${suffix}`,
      name: "send-email",
      data: { emailId, projectId },
      attempts: 0,
      maxAttempts: 5,
      createdAt: new Date(),
    });
    expect(outcome).toBe("failed");

    const db = getDb();
    const [email] = await db.select().from(emails).where(eq(emails.id, emailId)).limit(1);
    expect(email?.status).toBe("failed");
    expect(email?.providerMessageId).toBeNull();
    const [failedEvents] = await db
      .select({ value: count() })
      .from(emailEvents)
      .where(and(eq(emailEvents.emailId, emailId), eq(emailEvents.type, "failed")));
    expect(Number(failedEvents?.value)).toBeGreaterThanOrEqual(1);
    const [meter] = await db
      .select({ value: count() })
      .from(usageRecords)
      .where(eq(usageRecords.id, `ur_${emailId}`));
    expect(Number(meter?.value ?? 0)).toBe(0);
  });
});
