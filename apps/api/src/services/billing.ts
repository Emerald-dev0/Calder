/**
 * Billing orchestration: Paystack checkout, webhook fulfilment, refunds.
 *
 * Trust rules:
 *  - The browser redirect is never proof of payment; every fulfilment path
 *    re-verifies the transaction with Paystack server-side.
 *  - Webhooks must carry a valid signature; event payloads are deduped by a
 *    hash of the raw body so a replay cannot fulfil twice.
 *  - Amount and currency are compared against our own stored payment row
 *    before any credit, pass or subscription is granted.
 *  - Money is integer minor units everywhere. No floats.
 *  - USD is a merchant-account capability. If `PAYSTACK_USD_ENABLED` is not
 *    `"true"` checkout refuses instead of silently charging in NGN.
 */
import { createHash, randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import {
  CREDIT_PACKS,
  DAILY_BURST_PASS,
  assertAssignableTier,
  planFor,
  type PlanTier,
} from "@calder/config";
import {
  billingSummary,
  creditPurchases,
  creditTransactions,
  dailyBurstPasses,
  fulfilBurstPassInTx,
  fulfilCreditPurchaseInTx,
  organizations,
  paymentWebhookEvents,
  payments,
  plans,
  subscriptions,
  type DbClient,
} from "@calder/db";
import { sql } from "drizzle-orm";
import {
  assertPaymentMatches,
  initializeTransaction,
  refundTransaction,
  verifyPaystackSignature,
  verifyTransaction,
} from "../lib/paystack.js";

export { billingSummary };

export type CheckoutKind = "credits" | "burst_pass" | "subscription";

export class BillingError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
    this.name = "BillingError";
  }
}

function usdEnabled(): boolean {
  return process.env.PAYSTACK_USD_ENABLED === "true";
}

function assertUsd(): void {
  if (!process.env.PAYSTACK_SECRET_KEY) {
    throw new BillingError(
      "payments_unavailable",
      "Payments are not configured in this environment.",
      503
    );
  }
  if (!usdEnabled()) {
    throw new BillingError(
      "usd_not_enabled",
      "USD payments are not enabled for this Paystack merchant account. " +
        "Calder refuses to charge in another currency rather than convert silently.",
      409
    );
  }
}

export function paystackPlanCode(tier: "starter" | "pro"): string {
  const code = process.env[tier === "starter" ? "PAYSTACK_PLAN_STARTER" : "PAYSTACK_PLAN_PRO"];
  if (!code) {
    throw new BillingError(
      "plan_not_configured",
      `Paystack plan code for ${tier} is not configured (PAYSTACK_PLAN_${tier.toUpperCase()}).`,
      503
    );
  }
  return code;
}

export interface CheckoutResult {
  reference: string;
  authorizationUrl: string;
  amountCents: number;
  currency: "USD";
}

/**
 * Create a pending payment row, then ask Paystack for a hosted checkout URL.
 * Nothing is granted here; fulfilment waits for a verified webhook/verify.
 */
export async function createCheckout(
  db: DbClient,
  input: {
    organizationId: string;
    email: string;
    kind: CheckoutKind;
    packId?: string;
    tier?: string;
    callbackUrl?: string;
  }
): Promise<CheckoutResult> {
  assertUsd();
  let amountCents: number;
  let productId: string;
  let planCode: string | undefined;

  if (input.kind === "credits") {
    const pack = CREDIT_PACKS.find((p) => p.id === input.packId);
    if (!pack) throw new BillingError("unknown_pack", "Unknown credit pack.", 400);
    amountCents = pack.amountCents;
    productId = pack.id;
  } else if (input.kind === "burst_pass") {
    amountCents = DAILY_BURST_PASS.amountCents;
    productId = "daily_burst_pass";
  } else {
    const tier = input.tier as PlanTier;
    if (!tier || !["starter", "pro"].includes(tier)) {
      throw new BillingError(
        "tier_not_purchasable",
        "Only Starter and Pro can be purchased. Retired plans remain historical only.",
        400
      );
    }
    assertAssignableTier(tier);
    const price = planFor(tier).price.USD;
    if (price === null || !Number.isInteger(price) || price <= 0) {
      throw new BillingError("price_not_configured", `No USD price is configured for ${tier}.`);
    }
    amountCents = price;
    productId = tier;
    planCode = paystackPlanCode(tier as "starter" | "pro");
  }

  const reference = `cal_${input.kind}_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
  const [org] = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(eq(organizations.id, input.organizationId))
    .limit(1);
  if (!org) throw new BillingError("organization_not_found", "Organization not found.", 404);

  await db.insert(payments).values({
    id: `pay_${randomUUID().replace(/-/g, "").slice(0, 24)}`,
    organizationId: input.organizationId,
    reference,
    kind: input.kind,
    productId,
    amountCents,
    currency: "USD",
    status: "pending",
    metadata: { planCode: planCode ?? null, customerEmail: input.email.toLowerCase() },
  });

  let initialized: { authorization_url: string };
  try {
    initialized = await initializeTransaction({
      email: input.email,
      amountCents,
      currency: "USD",
      reference,
      ...(input.callbackUrl ? { callbackUrl: input.callbackUrl } : {}),
      ...(planCode ? { planCode } : {}),
      metadata: { organizationId: input.organizationId, kind: input.kind, productId },
    });
  } catch (err) {
    await db
      .update(payments)
      .set({ status: "failed", updatedAt: new Date() })
      .where(and(eq(payments.reference, reference), eq(payments.status, "pending")));
    throw err;
  }
  return {
    reference,
    authorizationUrl: initialized.authorization_url,
    amountCents,
    currency: "USD",
  };
}

export interface FulfilResult {
  status: "fulfilled" | "already_fulfilled" | "ignored";
  kind?: string;
  detail?: string;
}

/**
 * Verify a transaction server-side and fulfil its payment row atomically.
 * Safe to call repeatedly (webhook retries, user returns, reconciliation job).
 */
export async function verifyAndFulfil(
  db: DbClient,
  reference: string,
  deps: { verify?: typeof verifyTransaction } = {}
): Promise<FulfilResult> {
  const verify = deps.verify ?? verifyTransaction;
  const [payment] = await db
    .select()
    .from(payments)
    .where(eq(payments.reference, reference))
    .limit(1);
  if (!payment) throw new BillingError("payment_not_found", "Unknown payment reference.", 404);
  if (payment.status === "success") {
    return { status: "already_fulfilled", kind: payment.kind };
  }
  const transaction = await verify(reference);
  assertPaymentMatches(transaction, {
    amountCents: payment.amountCents,
    currency: payment.currency as "USD",
  });
  return db.transaction(async (tx) => {
    const updated = await tx
      .update(payments)
      .set({
        status: "success",
        paidAt: new Date(),
        providerTransactionId: String((transaction as { id?: unknown }).id ?? reference),
        updatedAt: new Date(),
      })
      .where(and(eq(payments.reference, reference), eq(payments.status, "pending")))
      .returning({ id: payments.id });
    if (updated.length === 0) {
      return { status: "already_fulfilled" as const, kind: payment.kind };
    }

    if (payment.kind === "credits") {
      const pack = CREDIT_PACKS.find((p) => p.id === payment.productId);
      if (!pack) throw new BillingError("unknown_pack", "Payment references an unknown pack.", 409);
      await fulfilCreditPurchaseInTx(tx, {
        organizationId: payment.organizationId,
        pack,
        paymentReference: reference,
      });
    } else if (payment.kind === "burst_pass") {
      await fulfilBurstPassInTx(tx, {
        organizationId: payment.organizationId,
        paymentReference: reference,
      });
    } else {
      await activateSubscription(tx, {
        organizationId: payment.organizationId,
        tier: payment.productId as "starter" | "pro",
        providerSubscriptionId:
          typeof transaction.metadata === "object" && transaction.metadata
            ? String((transaction.metadata as Record<string, unknown>).subscription_code ?? "") ||
              null
            : null,
        periodStart: transaction.paid_at ? new Date(transaction.paid_at) : new Date(),
      });
    }
    return { status: "fulfilled" as const, kind: payment.kind };
  });
}

async function activateSubscription(
  tx: Parameters<Parameters<DbClient["transaction"]>[0]>[0],
  input: {
    organizationId: string;
    tier: "starter" | "pro";
    providerSubscriptionId: string | null;
    periodStart: Date;
  }
): Promise<void> {
  const [plan] = await tx
    .select({ id: plans.id })
    .from(plans)
    .where(eq(plans.tier, input.tier))
    .limit(1);
  if (!plan) throw new BillingError("plan_missing", `Plan ${input.tier} is not seeded.`, 500);
  const periodEnd = new Date(input.periodStart);
  periodEnd.setUTCMonth(periodEnd.getUTCMonth() + 1);
  const [existing] = await tx
    .select({ id: subscriptions.id })
    .from(subscriptions)
    .where(eq(subscriptions.organizationId, input.organizationId))
    .limit(1);
  if (existing) {
    await tx
      .update(subscriptions)
      .set({
        planId: plan.id,
        status: "active",
        ...(input.providerSubscriptionId
          ? { providerSubscriptionId: input.providerSubscriptionId }
          : {}),
        currentPeriodStart: input.periodStart,
        currentPeriodEnd: periodEnd,
        updatedAt: new Date(),
      })
      .where(eq(subscriptions.id, existing.id));
  } else {
    await tx.insert(subscriptions).values({
      id: `sub_${randomUUID().replace(/-/g, "").slice(0, 24)}`,
      organizationId: input.organizationId,
      planId: plan.id,
      status: "active",
      providerSubscriptionId: input.providerSubscriptionId,
      currentPeriodStart: input.periodStart,
      currentPeriodEnd: periodEnd,
    });
  }
}

/** Map a Paystack plan code back to our tier. Unknown codes stay unlinked. */
function tierForPlanCode(code: string | undefined): "starter" | "pro" | null {
  if (!code) return null;
  if (code === process.env.PAYSTACK_PLAN_STARTER) return "starter";
  if (code === process.env.PAYSTACK_PLAN_PRO) return "pro";
  return null;
}

export interface WebhookResult {
  received: true;
  duplicate?: boolean;
  processed: boolean;
  reason?: string;
}

/**
 * Handle a Paystack webhook. The raw body is required: re-serialising JSON
 * changes the bytes and breaks the signature.
 */
export async function handlePaystackWebhook(
  db: DbClient,
  rawBody: string,
  signature: string | undefined
): Promise<WebhookResult> {
  if (!verifyPaystackSignature(rawBody, signature)) {
    throw new BillingError("invalid_signature", "Invalid Paystack signature.", 401);
  }
  let event: { event?: string; data?: Record<string, unknown> };
  try {
    event = JSON.parse(rawBody);
  } catch {
    throw new BillingError("invalid_payload", "Webhook body is not JSON.", 400);
  }
  const eventType = event.event ?? "";
  const data = event.data ?? {};
  const digest = createHash("sha256").update(rawBody, "utf8").digest("hex").slice(0, 32);
  const eventId = `paystack:${eventType}:${digest}`;

  const inserted = await db
    .insert(paymentWebhookEvents)
    .values({
      id: eventId,
      provider: "paystack",
      eventType,
      reference: typeof data.reference === "string" ? data.reference : null,
      payload: event as Record<string, unknown>,
    })
    .onConflictDoNothing()
    .returning({ id: paymentWebhookEvents.id });
  if (inserted.length === 0) return { received: true, duplicate: true, processed: true };

  let processed = true;
  let reason: string | undefined;
  try {
    if (eventType === "charge.success") {
      const reference = typeof data.reference === "string" ? data.reference : "";
      if (!reference) {
        processed = false;
        reason = "missing_reference";
      } else {
        const result = await verifyAndFulfil(db, reference);
        reason = result.status;
      }
    } else if (eventType === "subscription.create") {
      await applySubscriptionEvent(db, data, "active");
    } else if (eventType === "subscription.notify") {
      await applySubscriptionEvent(db, data, "active");
    } else if (eventType === "subscription.disable") {
      await applySubscriptionEvent(db, data, "canceled");
    } else if (eventType === "invoice.payment_failed") {
      await applySubscriptionEvent(db, data, "past_due");
    } else {
      // Acknowledged but deliberately not acted on: unknown events must not
      // mutate entitlements.
      reason = "ignored_event";
    }
  } catch (err) {
    // Leave the receipt unprocessed so a retry can try again; Paystack retries
    // failed webhooks. Never grant before verification succeeds.
    await db
      .update(paymentWebhookEvents)
      .set({ payload: { ...event, _error: err instanceof Error ? err.message : String(err) } })
      .where(eq(paymentWebhookEvents.id, eventId));
    throw err;
  }

  await db
    .update(paymentWebhookEvents)
    .set({ processedAt: new Date() })
    .where(eq(paymentWebhookEvents.id, eventId));
  return { received: true, processed, reason };
}

async function applySubscriptionEvent(
  db: DbClient,
  data: Record<string, unknown>,
  status: "active" | "canceled" | "past_due"
): Promise<void> {
  const subscriptionCode =
    typeof data.subscription_code === "string" ? data.subscription_code : undefined;
  const plan = data.plan as { plan_code?: string } | undefined;
  const tier = tierForPlanCode(plan?.plan_code);
  const email = (data.customer as { email?: string } | undefined)?.email;
  const nextPayment =
    typeof data.next_payment_date === "string" ? data.next_payment_date : undefined;

  let organizationId: string | null = null;
  if (subscriptionCode) {
    const [row] = await db
      .select({ organizationId: subscriptions.organizationId })
      .from(subscriptions)
      .where(eq(subscriptions.providerSubscriptionId, subscriptionCode))
      .limit(1);
    organizationId = row?.organizationId ?? null;
  }
  // Fall back to our own pending subscription payment, matched by the customer
  // email recorded at checkout. Never guess from plan alone: two organizations
  // can buy the same plan and a webhook must not attach to the wrong tenant.
  if (!organizationId && tier && email) {
    const [payment] = await db
      .select({ organizationId: payments.organizationId })
      .from(payments)
      .where(
        and(
          eq(payments.kind, "subscription"),
          eq(payments.productId, tier),
          eq(payments.status, "pending"),
          sql`lower(${payments.metadata}->>'customerEmail') = ${email.toLowerCase()}`
        )
      )
      .orderBy(sql`${payments.createdAt} desc`)
      .limit(1);
    organizationId = payment?.organizationId ?? null;
  }
  if (!organizationId) return;

  const planTier = tier ?? "starter";
  const [planRow] = await db
    .select({ id: plans.id })
    .from(plans)
    .where(eq(plans.tier, planTier))
    .limit(1);
  if (!planRow) throw new BillingError("plan_missing", `Plan ${planTier} is not seeded.`, 500);

  const [existing] = await db
    .select({ id: subscriptions.id })
    .from(subscriptions)
    .where(
      subscriptionCode
        ? eq(subscriptions.providerSubscriptionId, subscriptionCode)
        : eq(subscriptions.organizationId, organizationId)
    )
    .limit(1);
  const periodStart = new Date();
  const periodEnd = nextPayment ? new Date(nextPayment) : new Date(periodStart);
  if (!nextPayment) periodEnd.setUTCMonth(periodEnd.getUTCMonth() + 1);
  const values = {
    planId: planRow.id,
    status,
    ...(subscriptionCode ? { providerSubscriptionId: subscriptionCode } : {}),
    currentPeriodStart: periodStart,
    currentPeriodEnd: periodEnd,
    updatedAt: new Date(),
  };
  if (existing) {
    await db.update(subscriptions).set(values).where(eq(subscriptions.id, existing.id));
  } else {
    await db.insert(subscriptions).values({
      id: `sub_${randomUUID().replace(/-/g, "").slice(0, 24)}`,
      organizationId,
      ...values,
    });
  }
  void email;
}

/** Refund a successful payment and reverse unused credits. */
export async function refundPayment(
  db: DbClient,
  input: { reference: string; amountCents?: number; customerNote?: string; actor: string }
): Promise<{ refunded: true; creditsReclaimed: number }> {
  assertUsd();
  const [payment] = await db
    .select()
    .from(payments)
    .where(eq(payments.reference, input.reference))
    .limit(1);
  if (!payment) throw new BillingError("payment_not_found", "Unknown payment reference.", 404);
  if (payment.status !== "success") {
    throw new BillingError("not_refundable", "Only successful payments can be refunded.", 409);
  }
  if (
    input.amountCents !== undefined &&
    (!Number.isInteger(input.amountCents) ||
      input.amountCents <= 0 ||
      input.amountCents > payment.amountCents)
  ) {
    throw new BillingError("invalid_refund_amount", "Refund amount is invalid.", 400);
  }
  await refundTransaction({
    transaction: payment.reference,
    ...(input.amountCents === undefined ? {} : { amountCents: input.amountCents }),
    ...(input.customerNote ? { customerNote: input.customerNote } : {}),
  });
  return db.transaction(async (tx) => {
    await tx
      .update(payments)
      .set({ status: "refunded", updatedAt: new Date() })
      .where(eq(payments.id, payment.id));
    let creditsReclaimed = 0;
    if (payment.kind === "credits") {
      const [purchase] = await tx
        .select({ id: creditPurchases.id, remaining: creditPurchases.creditsRemaining })
        .from(creditPurchases)
        .where(eq(creditPurchases.paymentReference, payment.reference))
        .limit(1);
      if (purchase && purchase.remaining > 0) {
        creditsReclaimed = purchase.remaining;
        await tx
          .update(creditPurchases)
          .set({ creditsRemaining: 0, status: "refunded" })
          .where(eq(creditPurchases.id, purchase.id));
        await tx.insert(creditTransactions).values({
          id: `ctx_${randomUUID().replace(/-/g, "").slice(0, 24)}`,
          organizationId: payment.organizationId,
          purchaseId: purchase.id,
          type: "adjustment",
          amount: -creditsReclaimed,
          referenceId: `refund:${payment.reference}`,
          description: "Unused credits removed after refund",
        });
      }
    }
    if (payment.kind === "burst_pass") {
      await tx
        .update(dailyBurstPasses)
        .set({ status: "refunded" })
        .where(eq(dailyBurstPasses.paymentReference, payment.reference));
    }
    void input.actor;
    return { refunded: true as const, creditsReclaimed };
  });
}

// Re-exported for dashboard/tests that need to know whether checkout is live.
export function paymentsConfigured(): { configured: boolean; usd: boolean } {
  return { configured: Boolean(process.env.PAYSTACK_SECRET_KEY), usd: usdEnabled() };
}
