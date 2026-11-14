import { Hono } from "hono";
import type { Env } from "../app.js";
import { getDb } from "@calder/db";
import { eq } from "drizzle-orm";
import { payments } from "@calder/db";
import { authMiddleware, requireScope, type AuthContext } from "../middleware/auth.js";
import { AppError } from "../errors/index.js";
import {
  BillingError,
  billingSummary,
  createCheckout,
  paymentsConfigured,
  verifyAndFulfil,
} from "../services/billing.js";
import { PaystackNotConfiguredError } from "../lib/paystack.js";

const billing = new Hono<Env>();

function authOf(c: { get: (key: never) => unknown }): AuthContext & {
  organizationId: string;
  apiKeyId: string;
  env: "test" | "live";
  scope?: string;
} {
  return c.get("auth" as never) as AuthContext & {
    organizationId: string;
    apiKeyId: string;
    env: "test" | "live";
    scope?: string;
  };
}

function toHttp(err: unknown): never {
  if (err instanceof BillingError) {
    throw new AppError(err.code as never, err.message, err.status);
  }
  // An unconfigured provider is a deployment state, not a fault. Reporting it
  // as a 500 paged whoever watches 5xx for an environment that simply has no
  // Paystack credentials yet, and told the operator nothing actionable.
  if (err instanceof PaystackNotConfiguredError) {
    throw new AppError("payments_unavailable", err.message, 503);
  }
  throw err;
}

// Public and unauthenticated on purpose: it discloses only two booleans about
// the deployment (can it take money, can it take dollars) and lets the
// dashboard show an honest "payments are not connected yet" state without
// minting a key just to ask.
billing.get("/capabilities", (c) => {
  return c.json({ data: { capabilities: paymentsConfigured() } });
});

billing.get("/summary", authMiddleware, async (c) => {
  const auth = authOf(c);
  const summary = await billingSummary(getDb(), auth.organizationId);
  // Whether this deployment can take money at all is part of the summary: a
  // caller that has to discover it by attempting a charge learns it the
  // expensive way.
  return c.json({ data: { ...summary, capabilities: paymentsConfigured() } });
});

billing.post("/checkout", authMiddleware, async (c) => {
  const auth = authOf(c);
  requireScope(
    {
      type: "api_key",
      apiKeyId: auth.apiKeyId,
      projectId: auth.projectId,
      organizationId: auth.organizationId,
      env: auth.env,
      scope: auth.scope ?? "full",
      keyPrefix: "",
    },
    "send"
  );
  const body = (await c.req.json().catch(() => null)) as {
    kind?: string;
    packId?: string;
    tier?: string;
    email?: string;
  } | null;
  if (!body?.kind || !["credits", "burst_pass", "subscription"].includes(body.kind)) {
    throw new AppError("validation_error", "kind must be credits, burst_pass or subscription", 400);
  }
  if (!body.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) {
    throw new AppError("validation_error", "A customer email is required for checkout", 400);
  }
  try {
    const result = await createCheckout(getDb(), {
      organizationId: auth.organizationId,
      email: body.email,
      kind: body.kind as "credits" | "burst_pass" | "subscription",
      ...(body.packId ? { packId: body.packId } : {}),
      ...(body.tier ? { tier: body.tier } : {}),
      ...(process.env.PAYSTACK_CALLBACK_URL
        ? { callbackUrl: process.env.PAYSTACK_CALLBACK_URL }
        : {}),
    });
    return c.json({ data: result }, 201);
  } catch (err) {
    toHttp(err);
  }
});

billing.post("/verify/:reference", authMiddleware, async (c) => {
  const auth = authOf(c);
  const db = getDb();
  const reference = c.req.param("reference");
  const [row] = await db
    .select({ organizationId: payments.organizationId })
    .from(payments)
    .where(eq(payments.reference, reference))
    .limit(1);
  // Do not reveal whether another organization's reference exists.
  if (!row || row.organizationId !== auth.organizationId) {
    throw new AppError("payment_not_found", "Unknown payment reference.", 404);
  }
  try {
    const result = await verifyAndFulfil(db, reference);
    return c.json({ data: result });
  } catch (err) {
    toHttp(err);
  }
});

export default billing;
