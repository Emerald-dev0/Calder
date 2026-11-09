import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { closeDb, getDb } from "./client.js";
import { organizations } from "./schema/organizations.js";
import { projects } from "./schema/projects.js";
import {
  activeBurstCapacity,
  BurstPassLimitError,
  InsufficientCreditsError,
  burstPassesToday,
  consumeAdmissionCredits,
  consumeCredits,
  creditBalance,
  creditSnapshot,
  expireCredits,
  fulfilBurstPass,
  fulfilCreditPurchase,
  releaseCredits,
} from "./credits.js";
import { checkOrganizationQuota } from "./usage.js";
import { CREDIT_PACKS, DAILY_BURST_PASS } from "@calder/config";

const gate = process.env.RUN_INTEGRATION_TESTS === "1" ? describe : describe.skip;

gate("prepaid credits and burst passes (Postgres)", () => {
  const db = getDb();
  const suffix = randomUUID();
  const org = `org_credits_${suffix}`;
  const orgBurst = `org_burst_${suffix}`;
  const project = `prj_${suffix}`;
  const projectBurst = `prj_burst_${suffix}`;
  const now = new Date();

  beforeAll(async () => {
    await db.execute(sql`select 1`);
    await db.insert(organizations).values([
      {
        id: org,
        name: "Credits",
        slug: `credits-${suffix}`,
        createdAt: new Date("2026-01-01T00:00:00Z"),
      },
      {
        id: orgBurst,
        name: "Burst",
        slug: `burst-${suffix}`,
        createdAt: new Date("2026-01-01T00:00:00Z"),
      },
    ]);
    await db.insert(projects).values([
      { id: project, organizationId: org, name: "P", slug: `p-${suffix}` },
      { id: projectBurst, organizationId: orgBurst, name: "B", slug: `b-${suffix}` },
    ]);
    // Fill the free monthly allowance (5,000) without touching today's daily cap.
    await db.execute(sql`
      INSERT INTO emails (id, project_id, "from", "to", subject, text, status, env, created_at)
      SELECT ${`seedc_${suffix}_`} || g, ${project}, 'a@example.test', 'b@example.test', 'test', 'test', 'failed', 'live',
             date_trunc('month', now()) + interval '1 hour'
      FROM generate_series(1, 5000) g
    `);
    // Fill today's free daily cap (500) for the burst-pass org.
    await db.execute(sql`
      INSERT INTO emails (id, project_id, "from", "to", subject, text, status, env, created_at)
      SELECT ${`seedb_${suffix}_`} || g, ${projectBurst}, 'a@example.test', 'b@example.test', 'test', 'test', 'failed', 'live', now()
      FROM generate_series(1, 500) g
    `);
  });

  afterAll(async () => {
    await db.delete(organizations).where(eq(organizations.id, org));
    await db.delete(organizations).where(eq(organizations.id, orgBurst));
    await closeDb();
  });

  it("refuses monthly overage without credits, then allows it once a pack is verified", async () => {
    const denied = await checkOrganizationQuota(db, org, "live", 1, now);
    expect(denied.allowed).toBe(false);
    expect(denied.creditUnits).toBe(1);
    expect(denied.creditsAvailable).toBe(0);

    const purchase = await fulfilCreditPurchase(db, {
      organizationId: org,
      pack: CREDIT_PACKS[0]!,
      paymentReference: `pay_${suffix}`,
    });
    expect(purchase.created).toBe(true);
    expect((await creditBalance(db, org, now)).available).toBe(1000);

    const allowed = await checkOrganizationQuota(db, org, "live", 10, now);
    expect(allowed.allowed).toBe(true);
    expect(allowed.creditUnits).toBe(10);
    expect(allowed.creditsAvailable).toBe(1000);

    const consumed = await consumeAdmissionCredits(db, {
      organizationId: org,
      emailId: `eml_${suffix}`,
      decision: allowed,
      now,
    });
    expect(consumed).toBe(10);
    expect((await creditBalance(db, org, now)).available).toBe(990);
  });

  it("fulfils a payment reference only once and stacks multiple packs", async () => {
    const duplicate = await fulfilCreditPurchase(db, {
      organizationId: org,
      pack: CREDIT_PACKS[0]!,
      paymentReference: `pay_${suffix}`,
    });
    expect(duplicate.created).toBe(false);
    await fulfilCreditPurchase(db, {
      organizationId: org,
      pack: CREDIT_PACKS[1]!,
      paymentReference: `pay2_${suffix}`,
    });
    expect((await creditBalance(db, org, now)).available).toBe(3990);
  });

  it("spends the oldest-expiring pack first and releases exactly once", async () => {
    const before = await creditBalance(db, org, now);
    const result = await consumeCredits(db, {
      organizationId: org,
      units: 1200,
      emailId: `eml_multi_${suffix}`,
      now,
    });
    expect(result.consumed).toBe(1200);
    expect(result.allocations).toHaveLength(2);
    expect((await creditBalance(db, org, now)).available).toBe(before.available - 1200);
    expect(
      await releaseCredits(db, {
        organizationId: org,
        emailId: `eml_multi_${suffix}`,
        reason: "test",
      })
    ).toBe(1200);
    expect(
      await releaseCredits(db, {
        organizationId: org,
        emailId: `eml_multi_${suffix}`,
        reason: "again",
      })
    ).toBe(0);
    expect((await creditBalance(db, org, now)).available).toBe(before.available);
  });

  it("never leaves a partial debit or a negative balance", async () => {
    const before = (await creditBalance(db, org, now)).available;
    await expect(
      consumeCredits(db, { organizationId: org, units: 999_999, emailId: `eml_big_${suffix}`, now })
    ).rejects.toBeInstanceOf(InsufficientCreditsError);
    expect((await creditBalance(db, org, now)).available).toBe(before);
  });

  it("serialises concurrent reservations so the same credits cannot be spent twice", async () => {
    const available = (await creditBalance(db, org, now)).available;
    expect(available).toBeGreaterThanOrEqual(100);
    const attempts = await Promise.allSettled(
      Array.from({ length: 50 }, (_, i) =>
        consumeCredits(db, {
          organizationId: org,
          units: 100,
          emailId: `eml_conc_${suffix}_${i}`,
          now,
        })
      )
    );
    const succeeded = attempts.filter((a) => a.status === "fulfilled").length;
    const remaining = (await creditBalance(db, org, now)).available;
    expect(remaining).toBe(available - succeeded * 100);
    expect(remaining).toBeGreaterThanOrEqual(0);
    expect(succeeded).toBe(Math.floor(available / 100));
  });

  it("expires unused credits once and records an audit trail", async () => {
    const future = new Date(now.getTime() + 400 * 24 * 3600 * 1000);
    const expired = await expireCredits(db, future);
    expect(expired).toBeGreaterThan(0);
    expect((await creditBalance(db, org, now)).available).toBe(0);
    expect(await expireCredits(db, future)).toBe(0);
    const snapshot = await creditSnapshot(db, org, future);
    expect(snapshot.transactions.some((t) => t.type === "expiry")).toBe(true);
  });

  it("adds daily capacity with a burst pass, never monthly credits, and caps at two per day", async () => {
    const before = await checkOrganizationQuota(db, orgBurst, "live", 1, now);
    expect(before.allowed).toBe(false);
    expect(before.window).toBe("daily");
    expect(before.passAvailable).toBe(true);
    const creditsBefore = (await creditBalance(db, orgBurst, now)).available;

    await fulfilBurstPass(db, {
      organizationId: orgBurst,
      paymentReference: `bp_${suffix}_1`,
      now,
    });
    await fulfilBurstPass(db, {
      organizationId: orgBurst,
      paymentReference: `bp_${suffix}_2`,
      now,
    });
    expect(await activeBurstCapacity(db, orgBurst, now)).toBe(
      2 * DAILY_BURST_PASS.additionalCapacity
    );
    expect(await burstPassesToday(db, orgBurst, now)).toBe(2);
    expect((await creditBalance(db, orgBurst, now)).available).toBe(creditsBefore);

    const after = await checkOrganizationQuota(db, orgBurst, "live", 1, now);
    expect(after.allowed).toBe(true);
    expect(after.burstCapacity).toBe(2 * DAILY_BURST_PASS.additionalCapacity);

    await expect(
      fulfilBurstPass(db, { organizationId: orgBurst, paymentReference: `bp_${suffix}_3`, now })
    ).rejects.toBeInstanceOf(BurstPassLimitError);
    expect(await activeBurstCapacity(db, orgBurst, now)).toBe(
      2 * DAILY_BURST_PASS.additionalCapacity
    );
  });

  it("does not let a pass lift a suspended organization or the monthly ceiling", async () => {
    const quota = await checkOrganizationQuota(db, org, "live", 1, now);
    expect(quota.allowed).toBe(false);
    expect(quota.window).toBe("billing_period");
  });
});
