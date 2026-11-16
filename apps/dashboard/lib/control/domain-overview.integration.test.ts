import { describe, it, expect } from "vitest";

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
 * Domains page + mail totals (live Postgres).
 *
 * The Domains page is the one place that answers "which domains do we have and
 * are they set up?", so its two halves must agree: the headline counts and the
 * table are separate queries, and a filter that quietly changed the counts
 * would make the page lie about the estate while still looking plausible.
 */
gate("domain overview (live Postgres)", async () => {
  it("counts every domain once and filters without changing the counts", async () => {
    if (!(await reachable())) return;
    const { domainOverview } = await import("./queries.js");

    const all = await domainOverview("all");
    const c = all.counts;
    expect(c.total).toBe(c.verified + c.pending + c.failed + c.expired);
    expect(all.rows.length).toBeLessThanOrEqual(c.total);

    for (const row of all.rows) {
      expect(row.domain.length).toBeGreaterThan(0);
      expect(row.url).toBe(`https://${row.domain}`);
      expect(row.projectId.length).toBeGreaterThan(0);
      expect(row.organizationId.length).toBeGreaterThan(0);
      expect(row.dkimRecordCount).toBeGreaterThanOrEqual(0);
    }

    for (const status of ["verified", "pending", "failed", "expired"] as const) {
      const filtered = await domainOverview(status);
      expect(filtered.counts).toEqual(c); // counts never follow the filter
      expect(filtered.rows.every((r) => r.status === status)).toBe(true);
      expect(filtered.rows.length).toBeLessThanOrEqual(c[status]);
    }
  });

  it("searches by name without inventing matches", async () => {
    if (!(await reachable())) return;
    const { domainOverview } = await import("./queries.js");
    const all = await domainOverview("all");
    const sample = all.rows[0];
    if (!sample) return;

    const hit = await domainOverview("all", sample.domain);
    expect(hit.rows.some((r) => r.domain === sample.domain)).toBe(true);

    const miss = await domainOverview("all", "no-such-domain-zzz.invalid");
    expect(miss.rows).toEqual([]);
    expect(miss.counts).toEqual(all.counts);
  });
});

gate("platform mail totals (live Postgres)", async () => {
  it("adds both ledgers and never exceeds its own all-time figure", async () => {
    if (!(await reachable())) return;
    const { platformMailTotals } = await import("./queries.js");

    const allTime = await platformMailTotals(null);
    const month = await platformMailTotals(30);

    for (const n of [
      allTime.customerLive,
      allTime.customerTest,
      allTime.companySent,
      allTime.companySkipped,
      allTime.companyFailed,
      allTime.companyQueued,
      allTime.totalAccepted,
      month.totalAccepted,
    ]) {
      expect(Number.isInteger(n)).toBe(true);
      expect(n).toBeGreaterThanOrEqual(0);
    }

    expect(allTime.windowDays).toBeNull();
    expect(month.windowDays).toBe(30);
    // The total is arithmetic over two separately counted ledgers.
    expect(allTime.totalAccepted).toBe(allTime.customerLive + allTime.companySent);
    expect(month.totalAccepted).toBe(month.customerLive + month.companySent);
    // A 30-day window is a subset of all time.
    expect(month.customerLive).toBeLessThanOrEqual(allTime.customerLive);
    expect(month.companySent).toBeLessThanOrEqual(allTime.companySent);
  });
});
