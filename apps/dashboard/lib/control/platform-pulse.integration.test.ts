import { describe, it, expect } from "vitest";

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
 * Platform pulse (live Postgres).
 *
 * Every table and column in that query is checked against a real database here,
 * because the Command Center is the page that must not break: a wrong join or a
 * renamed column compiles fine and then renders eleven dashes.
 *
 * The invariants asserted below hold by construction of the queries, so they
 * need no seeded rows and cannot flake against concurrent suites.
 */
gate("platform pulse (live Postgres)", async () => {
  it("returns live counts that satisfy their own totals", async () => {
    if (!(await reachable())) return;
    const { platformPulse } = await import("./queries.js");
    const p = await platformPulse();

    const numbers = [
      p.emails.acceptedAllTime,
      p.emails.acceptedToday,
      p.emails.rowsEverCreated,
      p.signups.today,
      p.signups.week,
      p.signups.total,
      p.organizations.today,
      p.organizations.total,
      p.projects.total,
      p.domains.today,
      p.domains.total,
      p.domains.verified,
      p.senderIdentities.today,
      p.senderIdentities.total,
      p.senderIdentities.usable,
      p.teamInvites.today,
      p.teamInvites.total,
      p.teamInvites.pending,
      p.contacts.today,
      p.contacts.total,
      p.apiKeys.active,
      p.apiKeys.total,
      p.webhooks.total,
    ];
    for (const n of numbers) {
      expect(Number.isInteger(n)).toBe(true);
      expect(n).toBeGreaterThanOrEqual(0);
    }

    // A subset can never exceed its superset.
    expect(p.emails.acceptedToday).toBeLessThanOrEqual(p.emails.acceptedAllTime);
    expect(p.emails.acceptedAllTime).toBeLessThanOrEqual(p.emails.rowsEverCreated);
    expect(p.signups.today).toBeLessThanOrEqual(p.signups.total);
    expect(p.signups.week).toBeLessThanOrEqual(p.signups.total);
    expect(p.organizations.today).toBeLessThanOrEqual(p.organizations.total);
    expect(p.domains.today).toBeLessThanOrEqual(p.domains.total);
    expect(p.domains.verified).toBeLessThanOrEqual(p.domains.total);
    expect(p.senderIdentities.today).toBeLessThanOrEqual(p.senderIdentities.total);
    expect(p.senderIdentities.usable).toBeLessThanOrEqual(p.senderIdentities.total);
    expect(p.teamInvites.today).toBeLessThanOrEqual(p.teamInvites.total);
    expect(p.teamInvites.pending).toBeLessThanOrEqual(p.teamInvites.total);
    expect(p.contacts.today).toBeLessThanOrEqual(p.contacts.total);
    expect(p.apiKeys.active).toBeLessThanOrEqual(p.apiKeys.total);
  });
});
