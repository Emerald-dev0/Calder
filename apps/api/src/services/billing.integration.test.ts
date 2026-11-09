import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import {
  closeDb,
  creditBalance,
  getDb,
  organizations,
  payments,
  plans,
  subscriptions,
} from "@calder/db";
import { CREDIT_PACKS, DAILY_BURST_PASS } from "@calder/config";
import { handlePaystackWebhook, refundPayment, verifyAndFulfil } from "./billing.js";

const gate = process.env.RUN_INTEGRATION_TESTS === "1" ? describe : describe.skip;

gate("Paystack fulfilment (mocked provider, real database)", () => {
  const db = getDb();
  const suffix = randomUUID();
  const org = `org_billing_${suffix}`;
  let creditReference: string;
  let burstReference: string;
  let subReference: string;

  const verified =
    (over: Partial<Record<string, unknown>> = {}) =>
    async (reference: string) => ({
      reference,
      status: "success",
      amount: 0,
      currency: "USD",
      paid_at: new Date().toISOString(),
      ...over,
    });

  beforeAll(async () => {
    await db.execute(sql`select 1`);
    await db.insert(organizations).values({ id: org, name: "Billing", slug: `billing-${suffix}` });
    // Plans are part of the seeded catalogue; ensure the two commercial tiers
    // exist for the subscription path without touching retired tiers.
    for (const tier of ["starter", "pro"] as const) {
      const existing = await db.select({ id: plans.id }).from(plans).where(eq(plans.tier, tier));
      if (existing.length === 0) {
        await db
          .insert(plans)
          .values({
            id: `plan_${tier}_${suffix}`,
            tier,
            name: tier === "starter" ? "Starter" : "Pro",
          })
          .onConflictDoNothing();
      }
    }
    creditReference = `cal_credits_${suffix}`;
    burstReference = `cal_burst_pass_${suffix}`;
    subReference = `cal_subscription_${suffix}`;
    await db.insert(payments).values([
      {
        id: `pay_c_${suffix}`,
        organizationId: org,
        reference: creditReference,
        kind: "credits",
        productId: CREDIT_PACKS[0]!.id,
        amountCents: CREDIT_PACKS[0]!.amountCents,
        currency: "USD",
        status: "pending",
      },
      {
        id: `pay_b_${suffix}`,
        organizationId: org,
        reference: burstReference,
        kind: "burst_pass",
        productId: "daily_burst_pass",
        amountCents: DAILY_BURST_PASS.amountCents,
        currency: "USD",
        status: "pending",
      },
      {
        id: `pay_s_${suffix}`,
        organizationId: org,
        reference: subReference,
        kind: "subscription",
        productId: "starter",
        amountCents: 500,
        currency: "USD",
        status: "pending",
      },
    ]);
  });

  afterAll(async () => {
    await db.delete(organizations).where(eq(organizations.id, org));
    await closeDb();
  });

  it("refuses a payment whose verified amount does not match", async () => {
    const reference = `cal_credits_bad_${suffix}`;
    await db.insert(payments).values({
      id: `pay_bad_${suffix}`,
      organizationId: org,
      reference,
      kind: "credits",
      productId: CREDIT_PACKS[0]!.id,
      amountCents: CREDIT_PACKS[0]!.amountCents,
      currency: "USD",
      status: "pending",
    });
    await expect(
      verifyAndFulfil(db, reference, {
        verify: verified({ amount: CREDIT_PACKS[0]!.amountCents + 1 }) as never,
      })
    ).rejects.toThrow(/Amount mismatch/);
    const [row] = await db.select().from(payments).where(eq(payments.reference, reference));
    expect(row!.status).toBe("pending");
  });

  it("refuses a verified transaction in another currency", async () => {
    await expect(
      verifyAndFulfil(db, creditReference, {
        verify: verified({ amount: CREDIT_PACKS[0]!.amountCents, currency: "NGN" }) as never,
      })
    ).rejects.toThrow(/Currency mismatch/);
  });

  it("grants a credit pack once and is idempotent on replay", async () => {
    const first = await verifyAndFulfil(db, creditReference, {
      verify: verified({ amount: CREDIT_PACKS[0]!.amountCents, id: 123 }) as never,
    });
    expect(first.status).toBe("fulfilled");
    expect((await creditBalance(db, org)).available).toBe(CREDIT_PACKS[0]!.credits);
    const replay = await verifyAndFulfil(db, creditReference, { verify: verified() as never });
    expect(replay.status).toBe("already_fulfilled");
    expect((await creditBalance(db, org)).available).toBe(CREDIT_PACKS[0]!.credits);
  });

  it("grants a burst pass as daily capacity, not monthly credits", async () => {
    const before = (await creditBalance(db, org)).available;
    const result = await verifyAndFulfil(db, burstReference, {
      verify: verified({ amount: DAILY_BURST_PASS.amountCents }) as never,
    });
    expect(result.status).toBe("fulfilled");
    expect((await creditBalance(db, org)).available).toBe(before);
  });

  it("activates a subscription after a verified first charge", async () => {
    const result = await verifyAndFulfil(db, subReference, {
      verify: verified({ amount: 500 }) as never,
    });
    expect(result.status).toBe("fulfilled");
    const [sub] = await db
      .select({ status: subscriptions.status, tier: plans.tier })
      .from(subscriptions)
      .innerJoin(plans, eq(plans.id, subscriptions.planId))
      .where(eq(subscriptions.organizationId, org))
      .limit(1);
    expect(sub).toMatchObject({ status: "active", tier: "starter" });
  });

  it("dedupes a replayed webhook and rejects a forged signature", async () => {
    const { createHmac } = await import("node:crypto");
    process.env.PAYSTACK_SECRET_KEY = "sk_test_webhook";
    const body = JSON.stringify({
      event: "charge.success",
      data: { reference: creditReference, id: 1 },
    });
    const signature = createHmac("sha512", "sk_test_webhook").update(body).digest("hex");
    const first = await handlePaystackWebhook(db, body, signature);
    expect(first.received).toBe(true);
    expect(first.duplicate).toBeUndefined();
    const replay = await handlePaystackWebhook(db, body, signature);
    expect(replay.duplicate).toBe(true);
    await expect(handlePaystackWebhook(db, body, "deadbeef")).rejects.toThrow(/signature/i);
    delete process.env.PAYSTACK_SECRET_KEY;
  });

  it("marks a payment refunded and reclaims unused credits", async () => {
    process.env.PAYSTACK_SECRET_KEY = "sk_test_refund";
    process.env.PAYSTACK_USD_ENABLED = "true";
    const fetchMock = async () =>
      new Response(JSON.stringify({ status: true, data: { id: 9, status: "pending" } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    try {
      const result = await refundPayment(db, {
        reference: creditReference,
        actor: "test",
      });
      expect(result.refunded).toBe(true);
      expect(result.creditsReclaimed).toBeGreaterThan(0);
      expect((await creditBalance(db, org)).available).toBe(0);
    } finally {
      globalThis.fetch = originalFetch;
      delete process.env.PAYSTACK_SECRET_KEY;
      delete process.env.PAYSTACK_USD_ENABLED;
    }
  });
});
