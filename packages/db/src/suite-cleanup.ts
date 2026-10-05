import { and, eq, inArray, isNull, lte, or, count, type SQL } from "drizzle-orm";
import { emails } from "./schema/emails.js";
import { organizations, organizationMembers } from "./schema/organizations.js";
import { projects } from "./schema/projects.js";
import { users } from "./schema/users.js";
import type { DbClient } from "./client.js";

/**
 * Rows a drain could still pick up: claimed (`sending`, held or stale) or
 * due (`queued` with no future schedule). Mirrors claimDrainBatch's WHERE.
 * Future-scheduled rows are NOT in flight — waiting on them would hang
 * cleanup until they come due.
 */
function drainable(): SQL {
  return or(
    eq(emails.status, "sending"),
    and(
      eq(emails.status, "queued"),
      or(isNull(emails.scheduledFor), lte(emails.scheduledFor, new Date()))
    )
  )!;
}

/**
 * Test-only helper. Integration suites share one database and run in
 * parallel workers, while drains are global: any drain may claim any queued
 * row. A suite must therefore never delete its org while its rows could
 * still be in flight elsewhere — the cascade (org → projects → emails →
 * events) would pull claimed rows out from under another drain's terminal
 * writes. Drain code tolerates that (skips the event), but the suite's own
 * assertions do not tolerate vanishing rows.
 *
 * Call `settleSuiteEmails` after the last send, then `cleanupSuiteOrg` in
 * `afterAll`. Both are bounded; neither throws on missing rows.
 */
export async function settleSuiteEmails(
  db: DbClient,
  emailIds: string[],
  drain: () => Promise<unknown>,
  rounds = 5
): Promise<void> {
  if (emailIds.length === 0) return;
  for (let i = 0; i < rounds; i++) {
    const [pending] = await db
      .select({ value: count() })
      .from(emails)
      .where(and(inArray(emails.id, emailIds), drainable()));
    if (Number(pending?.value ?? 0) === 0) return;
    await drain();
  }
}

/**
 * Wait (bounded) until no email of this org is queued or claimed anywhere,
 * then delete the org (cascades projects/emails/events/keys/webhooks/
 * suppressions) plus the suite user. Deleting while another file's drain
 * holds one of our rows is what used to produce foreign-key failures and
 * flaky assertions under parallel CI.
 *
 * Phase 2: the org's own rows are first terminalised (`queued`/`sending` →
 * `failed`). Suites legitimately leave accepted-but-undrained sends behind
 * (ingest tests assert the 202 and stop), and previously that meant this
 * helper polled for the full 10-second budget on rows nothing would ever
 * drain — which broke `afterAll` with "Hook timed out in 10000ms" whenever
 * integration tests ran with RUN_INTEGRATION_TESTS=1. Terminalising test
 * fixtures is safe: a drain that already claimed one of these rows tolerates
 * the row disappearing (see lib/drain.ts / recordDrainEvent), and no
 * production code path is affected.
 */
export async function cleanupSuiteOrg(
  db: DbClient,
  orgId: string,
  userId?: string,
  opts: { pollMs?: number; rounds?: number } = {}
): Promise<void> {
  const pollMs = opts.pollMs ?? 200;
  const rounds = opts.rounds ?? 5;

  // Terminalise this suite's own drainable rows before waiting. Test data only.
  await db
    .update(emails)
    .set({ status: "failed", lastError: "test suite cleanup", updatedAt: new Date() })
    .where(
      and(
        inArray(
          emails.projectId,
          db.select({ id: projects.id }).from(projects).where(eq(projects.organizationId, orgId))
        ),
        drainable()
      )
    );
  for (let i = 0; i < rounds; i++) {
    const [inflight] = await db
      .select({ value: count() })
      .from(emails)
      .innerJoin(projects, eq(emails.projectId, projects.id))
      .where(and(eq(projects.organizationId, orgId), drainable()));
    if (Number(inflight?.value ?? 0) === 0) break;
    await new Promise((r) => setTimeout(r, pollMs));
  }
  await db.delete(organizations).where(eq(organizations.id, orgId));
  // Belt and braces: membership rows reference org+user; the org delete
  // cascades, but an explicit pass keeps this helper correct even if the
  // cascade ever changes.
  await db.delete(organizationMembers).where(eq(organizationMembers.organizationId, orgId));
  if (userId) await db.delete(users).where(eq(users.id, userId));
}
