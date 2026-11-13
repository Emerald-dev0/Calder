"use server";

import { redirect } from "next/navigation";
import { getTenantContext, resolveProject } from "../../../lib/auth";
import { startCheckout, type CheckoutKind } from "../../../lib/billing/checkout";

/**
 * Start a Paystack checkout and hand the browser to Paystack.
 *
 * Rules this file keeps:
 *  - a server action is a public endpoint, so the project is resolved from the
 *    caller's own memberships, never from the form alone;
 *  - money writes are owner/admin only — a member cannot change what the
 *    organization pays;
 *  - every outcome ends in a redirect with a coarse code. Nothing here claims
 *    a payment succeeded: that is decided by the API verifying with Paystack.
 */

const KINDS: readonly CheckoutKind[] = ["credits", "burst_pass", "subscription"];

export async function startCheckoutAction(formData: FormData): Promise<void> {
  const ctx = await getTenantContext();
  const projectId = String(formData.get("projectId") ?? "");
  const scope = resolveProject(ctx, projectId || undefined);
  if (!scope) redirect("/billing?checkout=no_project");

  if (scope.role !== "owner" && scope.role !== "admin") {
    redirect("/billing?checkout=forbidden");
  }

  const kind = String(formData.get("kind") ?? "") as CheckoutKind;
  if (!KINDS.includes(kind)) redirect("/billing?checkout=bad_kind");

  const packId = formData.get("packId");
  const tier = formData.get("tier");
  const email = String(formData.get("email") ?? ctx.user.email).trim();
  const back = String(formData.get("back") ?? `/billing?project=${scope.project.id}`);

  const outcome = await startCheckout({
    projectId: scope.project.id,
    kind,
    email,
    ...(packId ? { packId: String(packId) } : {}),
    ...(tier ? { tier: String(tier) } : {}),
  });

  if (!outcome.ok) {
    const target = new URL(back, "http://dashboard.local");
    target.searchParams.set("checkout", outcome.code);
    redirect(`${target.pathname}${target.search}`);
  }

  // The only place a browser is sent to Paystack. The reference travels with
  // the payment row, so the callback URL does not need to carry it.
  redirect(outcome.authorizationUrl);
}

/**
 * Confirm one payment by reference. Called from the return page after Paystack
 * sends the customer back. Idempotent: the API verifies with Paystack and
 * fulfils at most once, so a refresh or a duplicate webhook is harmless.
 */
export async function confirmPaymentAction(
  projectId: string,
  reference: string
): Promise<{ ok: boolean; status?: string; message: string }> {
  const ctx = await getTenantContext();
  const scope = resolveProject(ctx, projectId || undefined);
  if (!scope) return { ok: false, message: "That project is not yours." };

  const { verifyPayment } = await import("../../../lib/billing/checkout");
  const outcome = await verifyPayment(scope.project.id, reference);
  if (!outcome.ok) return { ok: false, message: outcome.error };

  if (outcome.status === "fulfilled") {
    return {
      ok: true,
      status: outcome.status,
      message: "Payment confirmed. Your plan or credits are updated below.",
    };
  }
  if (outcome.status === "already_fulfilled") {
    return {
      ok: true,
      status: outcome.status,
      message: "This payment was already applied. Nothing was charged twice.",
    };
  }
  return {
    ok: false,
    status: outcome.status,
    message:
      "Paystack has not confirmed this payment yet. If money left your account, it will be applied automatically once Paystack reports it — nothing else is needed from you.",
  };
}
