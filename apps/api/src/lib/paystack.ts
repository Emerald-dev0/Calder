/**
 * Minimal Paystack client.
 *
 * Only documented endpoints are used:
 *  - POST /transaction/initialize
 *  - GET  /transaction/verify/:reference
 *  - POST /refund
 *
 * Currency support is an account capability, not a code assumption. Paystack
 * documents NGN, GHS, ZAR, KES and USD, but a merchant account must have USD
 * enabled and settlement happens in the business's registration currency
 * unless Paystack has explicitly enabled USD settlement. `assertUsdConfigured`
 * makes that a configuration decision rather than a silent conversion.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export const PAYSTACK_BASE_URL = "https://api.paystack.co";

export class PaystackNotConfiguredError extends Error {
  readonly code = "paystack_not_configured";
  constructor(message = "Paystack is not configured for this environment.") {
    super(message);
    this.name = "PaystackNotConfiguredError";
  }
}

export interface PaystackTransaction {
  reference: string;
  status: string;
  amount: number;
  currency: string;
  customer?: { email?: string };
  plan?: string | { plan_code?: string };
  paid_at?: string;
  metadata?: Record<string, unknown> | string | null;
}

export interface PaystackSubscription {
  subscription_code: string;
  status: string;
  plan: { plan_code: string; name?: string; amount?: number; currency?: string };
  customer?: { email?: string; customer_code?: string };
  next_payment_date?: string;
  email_token?: string;
}

export interface PaystackWebhookEvent {
  event: string;
  data: Record<string, unknown>;
}

export interface VerifyResult {
  status: boolean;
  message: string;
  data?: PaystackTransaction;
}

export function paystackSecret(): string {
  const key = process.env.PAYSTACK_SECRET_KEY ?? "";
  if (!key) throw new PaystackNotConfiguredError();
  return key;
}

export function paystackPublicKey(): string {
  return process.env.PAYSTACK_PUBLIC_KEY ?? "";
}

/**
 * Webhook signature: HMAC-SHA512 of the raw request body using the secret key,
 * per Paystack's documentation. Comparison is constant-time.
 */
export function verifyPaystackSignature(rawBody: string, signature: string | undefined): boolean {
  if (!signature) return false;
  let secret: string;
  try {
    secret = paystackSecret();
  } catch {
    return false;
  }
  const expected = createHmac("sha512", secret).update(rawBody, "utf8").digest("hex");
  const provided = signature.trim().toLowerCase();
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(expected, "utf8"), Buffer.from(provided, "utf8"));
}

async function request<T>(
  path: string,
  init: { method?: string; body?: unknown; fetchImpl?: typeof fetch }
): Promise<T> {
  const fetchImpl = init.fetchImpl ?? fetch;
  const response = await fetchImpl(`${PAYSTACK_BASE_URL}${path}`, {
    method: init.method ?? "GET",
    headers: {
      Authorization: `Bearer ${paystackSecret()}`,
      "Content-Type": "application/json",
    },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
  const payload = (await response.json().catch(() => null)) as {
    status?: boolean;
    message?: string;
    data?: T;
  } | null;
  if (!response.ok || !payload?.status) {
    throw new Error(payload?.message ?? `Paystack request failed (${response.status})`);
  }
  return payload.data as T;
}

export interface InitializeInput {
  email: string;
  /** Integer minor units (cents). Never a float. */
  amountCents: number;
  currency: "USD";
  reference: string;
  callbackUrl?: string;
  planCode?: string;
  metadata?: Record<string, unknown>;
}

export async function initializeTransaction(
  input: InitializeInput,
  fetchImpl?: typeof fetch
): Promise<{ authorization_url: string; access_code: string; reference: string }> {
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
    throw new Error("Paystack amount must be a positive integer in minor units");
  }
  return request("/transaction/initialize", {
    method: "POST",
    fetchImpl,
    body: {
      email: input.email,
      amount: input.amountCents,
      currency: input.currency,
      reference: input.reference,
      ...(input.callbackUrl ? { callback_url: input.callbackUrl } : {}),
      ...(input.planCode ? { plan: input.planCode } : {}),
      metadata: { ...input.metadata, currency: input.currency },
    },
  });
}

export async function verifyTransaction(
  reference: string,
  fetchImpl?: typeof fetch
): Promise<PaystackTransaction> {
  if (!reference || reference.length > 255) throw new Error("Invalid Paystack reference");
  return request<PaystackTransaction>(`/transaction/verify/${encodeURIComponent(reference)}`, {
    fetchImpl,
  });
}

export async function refundTransaction(
  input: { transaction: string; amountCents?: number; customerNote?: string },
  fetchImpl?: typeof fetch
): Promise<{ id: number; status: string }> {
  if (input.amountCents !== undefined && !Number.isInteger(input.amountCents)) {
    throw new Error("Refund amount must be an integer in minor units");
  }
  return request("/refund", {
    method: "POST",
    fetchImpl,
    body: {
      transaction: input.transaction,
      ...(input.amountCents === undefined ? {} : { amount: input.amountCents }),
      ...(input.customerNote ? { customer_note: input.customerNote } : {}),
    },
  });
}

/** Amount + currency guard used before any fulfillment. */
export function assertPaymentMatches(
  transaction: Pick<PaystackTransaction, "status" | "amount" | "currency">,
  expected: { amountCents: number; currency: "USD" }
): void {
  if (transaction.status !== "success") {
    throw new Error(`Payment not successful (status: ${transaction.status})`);
  }
  if (transaction.currency !== expected.currency) {
    throw new Error(
      `Currency mismatch: expected ${expected.currency}, received ${transaction.currency}`
    );
  }
  if (!Number.isInteger(transaction.amount) || transaction.amount !== expected.amountCents) {
    throw new Error(
      `Amount mismatch: expected ${expected.amountCents} minor units, received ${transaction.amount}`
    );
  }
}
