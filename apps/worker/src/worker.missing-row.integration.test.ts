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
 * Phase 0, M0.2 worker missing-row safety: a job whose email record does not
 * exist must fail closed, log the missing record, drop the job, send NOTHING
 * and never requeue forever. The old scaffold fabricated a synthetic send
 * here; that behavior is explicitly deleted and guarded by this test.
 */
gate("worker missing email record (live Postgres)", async () => {
  const { processEmailJob } = await import("./worker.js");
  const { getDb, emailEvents, emails } = await import("@calder/db");
  const { eq, and } = await import("drizzle-orm");

  const ghostEmailId = `em_missing_${Math.random().toString(36).slice(2, 12)}`;
  const ghostProjectId = `proj_missing_${Math.random().toString(36).slice(2, 12)}`;

  beforeAll(async () => {
    await reachable();
  });

  afterAll(async () => {
    if (!(await reachable())) return;
    const db = getDb();
    // Defensive: nothing should exist, but clean up if a bug ever writes rows.
    await db.delete(emailEvents).where(eq(emailEvents.emailId, ghostEmailId));
    await db.delete(emails).where(eq(emails.id, ghostEmailId));
  });

  it("drops the job without sending and without writing events", async () => {
    if (!(await reachable())) return;
    const outcome = await processEmailJob({
      id: `job_${ghostEmailId}`,
      name: "send-email",
      data: { emailId: ghostEmailId, projectId: ghostProjectId },
      attempts: 0,
      maxAttempts: 5,
      createdAt: new Date(),
    });

    expect(outcome).toBe("missing_record");

    const db = getDb();
    // No fabricated email row, no fabricated events of any kind.
    const emailRows = await db
      .select({ id: emails.id })
      .from(emails)
      .where(and(eq(emails.id, ghostEmailId), eq(emails.projectId, ghostProjectId)))
      .limit(1);
    expect(emailRows.length).toBe(0);
    const eventRows = await db
      .select({ id: emailEvents.id })
      .from(emailEvents)
      .where(eq(emailEvents.emailId, ghostEmailId))
      .limit(1);
    expect(eventRows.length).toBe(0);
  });
});
