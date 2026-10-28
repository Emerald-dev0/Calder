/**
 * Billing provider: Bachs.
 *
 * Sandbox keys are `sk_sandbox_…` and hit https://sandbox-api.bachs.io;
 * live keys are `sk_live_…` and hit https://api.bachs.io.
 *
 * Two rules this file must never break, because both failure modes are silent:
 *
 *   1. Never fabricate a successful checkout. A URL that returns the caller to
 *      `successUrl` without a payment is worse than an error: the customer is
 *      told they upgraded, the workspace still says Starter, and the first
 *      anybody hears about it is a chargeback or a support ticket.
 *
 *   2. Never accept a webhook on the strength of "a secret is configured".
 *      That is an authentication check that authenticates nothing — anyone who
 *      can reach the endpoint can grant themselves any plan.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

export type CheckoutSession = {
  id: string;
  url: string;
  customerId: string;
};

export interface BillingProvider {
  readonly name: string;
  createCheckoutSession(params: {
    organizationId: string;
    planId: string;
    successUrl: string;
    cancelUrl: string;
  }): Promise<CheckoutSession>;
  verifyWebhookSignature(payload: string, signature: string): boolean;
}

/** Thrown instead of inventing a checkout URL when billing is not wired up. */
export class BillingNotConfiguredError extends Error {
  readonly code = "billing_not_configured";

  constructor(detail: string) {
    super(
      `Billing is not configured: ${detail} ` +
        "Set BACHS_API_KEY (and BACHS_WEBHOOK_SECRET) before offering paid plans, " +
        "or publish the free plan only."
    );
    this.name = "BillingNotConfiguredError";
  }
}

/** Constant-time compare that does not leak the expected length by throwing. */
function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export class BachsBillingProvider implements BillingProvider {
  readonly name = "bachs";
  readonly apiKey: string;
  private readonly webhookSecret: string;

  constructor(env: NodeJS.ProcessEnv = process.env) {
    this.apiKey = env.BACHS_API_KEY ?? "";
    this.webhookSecret = env.BACHS_WEBHOOK_SECRET ?? "";
  }

  async createCheckoutSession(params: {
    organizationId: string;
    planId: string;
    successUrl: string;
    cancelUrl: string;
  }): Promise<CheckoutSession> {
    if (!this.apiKey) {
      throw new BillingNotConfiguredError(
        "no BACHS_API_KEY, so there is no way to collect a payment for " +
          `plan "${params.planId}".`
      );
    }
    // Deliberately not implemented rather than faked: the request body and
    // response shape have to come from Bachs' own API contract, and a guess
    // here would fail in production at the worst possible moment. Until that
    // is wired, refusing loudly keeps the dashboard honest.
    throw new BillingNotConfiguredError(
      "the checkout call to Bachs is not implemented yet; a key is present but " +
        "no request has been written against their API."
    );
  }

  /**
   * HMAC-SHA256 of the raw request body, keyed with the webhook secret.
   *
   * Accepts `sha256=<hex>`, `v1=<hex>` and a bare hex digest, because providers
   * differ in how they label it; all three are the same proof. The payload must
   * be the exact bytes received — re-serialising JSON changes the digest.
   */
  verifyWebhookSignature(payload: string, signature: string): boolean {
    if (!this.webhookSecret) return false;
    if (typeof signature !== "string" || signature.length === 0) return false;

    const expected = createHmac("sha256", this.webhookSecret).update(payload, "utf8").digest("hex");

    const presented = signature
      .trim()
      .split(",")
      .map((part) => part.trim())
      .map((part) => part.replace(/^(sha256|v1)=/i, "").toLowerCase());

    return presented.some((candidate) => safeEqual(candidate, expected));
  }
}
