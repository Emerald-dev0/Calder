import { getConfig } from "@calder/config";
import { withTemporaryKey } from "../temporary-key";

/**
 * Client for the API's billing surface.
 *
 * The dashboard renders the money view straight from the database (plan,
 * history and credits all live in `@calder/db`), but it cannot start or verify
 * a payment itself: the Paystack client, the amount/currency checks and the
 * fulfilment rules live in `apps/api`. Those are reached through the same
 * temporary-key pattern the broadcast dispatch uses.
 *
 * Nothing here decides whether a payment succeeded. `verifyPayment` asks the
 * API, which asks Paystack server-side; a browser redirect back from Paystack
 * is never treated as proof.
 */

export interface BillingCapabilities {
  payments: boolean;
  usd: boolean;
}

export type CheckoutKind = "credits" | "burst_pass" | "subscription";

export type CheckoutOutcome =
  | { ok: true; reference: string; authorizationUrl: string }
  | { ok: false; code: FailureCode; error: string; notConfigured: boolean };

export type VerifyOutcome =
  | { ok: true; status: "fulfilled" | "already_fulfilled" | "ignored"; detail?: string }
  | { ok: false; code: FailureCode; error: string };

/**
 * A coarse, non-sensitive reason for a failed attempt. It is what the page
 * redirects with (`?checkout=<code>`), so copy for each case lives in one
 * place and a raw provider message never becomes a query string.
 */
export type FailureCode =
  | "not_configured"
  | "plan_not_configured"
  | "price_not_configured"
  | "forbidden"
  | "not_found"
  | "failed";

function apiBase(): string {
  return getConfig().API_URL.replace(/\/$/, "");
}

/** Messages are shown to a customer who has just been asked for money. */
export function interpretFailure(
  status: number,
  payload: unknown
): {
  code: FailureCode;
  error: string;
  notConfigured: boolean;
} {
  const code =
    typeof payload === "object" && payload !== null
      ? ((payload as { error?: { code?: string } }).error?.code ?? "")
      : "";
  const message =
    typeof payload === "object" && payload !== null
      ? (payload as { error?: { message?: string } }).error?.message
      : undefined;

  // Specific codes first: a missing plan code is also a 503, and collapsing it
  // into "payments are off" would hide that credits may still work.
  if (code === "plan_not_configured") {
    return {
      code: "plan_not_configured",
      error:
        "Subscription checkout is not configured on this deployment yet, so nothing was charged.",
      notConfigured: true,
    };
  }
  if (code === "price_not_configured" || code === "tier_not_purchasable") {
    return {
      code: "price_not_configured",
      error: message ?? "That plan cannot be purchased on this deployment yet.",
      notConfigured: true,
    };
  }
  if (code === "payments_unavailable" || code === "payments_not_configured" || status === 503) {
    return {
      code: "not_configured",
      error:
        "Payments are not connected on this deployment yet, so nothing was charged. Your plan is unchanged.",
      notConfigured: true,
    };
  }
  if (status === 404) {
    return {
      code: "not_found",
      error: "That payment reference is not one of yours.",
      notConfigured: false,
    };
  }
  if (status === 401 || status === 403) {
    return {
      code: "forbidden",
      error: "This action is not allowed for your account. Ask an owner to upgrade the plan.",
      notConfigured: false,
    };
  }
  return {
    code: "failed",
    error: message ?? `The payments service answered ${status}. Nothing was charged.`,
    notConfigured: false,
  };
}

/**
 * Ask the API whether it can take money at all. Returns `null` when the answer
 * is unknown (service unreachable) — callers must then keep the buttons
 * enabled and let the attempt report the truth, rather than guessing.
 */
export async function billingCapabilities(): Promise<BillingCapabilities | null> {
  try {
    const res = await fetch(`${apiBase()}/v1/billing/capabilities`, {
      signal: AbortSignal.timeout(4_000),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const payload = (await res.json().catch(() => null)) as {
      data?: { capabilities?: { configured?: boolean; usd?: boolean } };
    } | null;
    const caps = payload?.data?.capabilities;
    if (!caps) return null;
    return { payments: caps.configured === true, usd: caps.usd === true };
  } catch {
    return null;
  }
}

export async function startCheckout(input: {
  projectId: string;
  kind: CheckoutKind;
  email: string;
  packId?: string;
  tier?: string;
}): Promise<CheckoutOutcome> {
  return withTemporaryKey(input.projectId, "billing checkout", async (key) => {
    try {
      const res = await fetch(`${apiBase()}/v1/billing/checkout`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          "Idempotency-Key": `checkout-${input.kind}-${Date.now()}`,
        },
        body: JSON.stringify({
          kind: input.kind,
          email: input.email,
          ...(input.packId ? { packId: input.packId } : {}),
          ...(input.tier ? { tier: input.tier } : {}),
        }),
        signal: AbortSignal.timeout(15_000),
      });
      const payload = (await res.json().catch(() => null)) as {
        data?: { reference?: string; authorizationUrl?: string };
      } | null;
      if (!res.ok) {
        const failure = interpretFailure(res.status, payload);
        return { ok: false, ...failure };
      }
      const url = payload?.data?.authorizationUrl;
      const reference = payload?.data?.reference;
      if (!url || !reference) {
        return {
          ok: false,
          code: "failed",
          notConfigured: false,
          error: "The payments service did not return a checkout link. Nothing was charged.",
        };
      }
      return { ok: true, authorizationUrl: url, reference };
    } catch {
      return {
        ok: false,
        code: "failed",
        notConfigured: false,
        error: "Could not reach the payments service. Nothing was charged.",
      };
    }
  });
}

export async function verifyPayment(projectId: string, reference: string): Promise<VerifyOutcome> {
  return withTemporaryKey(projectId, "billing verify", async (key) => {
    try {
      const res = await fetch(`${apiBase()}/v1/billing/verify/${encodeURIComponent(reference)}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(15_000),
      });
      const payload = (await res.json().catch(() => null)) as {
        data?: { status?: string; detail?: string };
      } | null;
      if (!res.ok) {
        const { code, error } = interpretFailure(res.status, payload);
        return { ok: false, code, error };
      }
      const status = payload?.data?.status;
      if (status !== "fulfilled" && status !== "already_fulfilled" && status !== "ignored") {
        return {
          ok: false,
          code: "failed",
          error: "The payments service gave an unexpected answer.",
        };
      }
      return {
        ok: true,
        status,
        ...(payload?.data?.detail ? { detail: payload.data.detail } : {}),
      };
    } catch {
      return {
        ok: false,
        code: "failed",
        error: "Could not reach the payments service to confirm the payment.",
      };
    }
  });
}
