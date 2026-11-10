import type { Metadata } from "next";

export const metadata: Metadata = {
  alternates: { canonical: "https://calder.click/docs/errors" },
  title: "Sending limit and payment errors, Calder Docs",
  description:
    "Stable error codes for daily limits, monthly allowance, credits, burst passes and payments.",
};

export default function ErrorReference() {
  return (
    <>
      <h1>Sending limit and payment errors</h1>
      <p className="docs-lede">
        Every error uses <code>{`{ "error": { "code", "message", "details", "hint" } }`}</code>.
        Codes are stable; detail fields are additive.
      </p>
      <h2>Daily limit reached</h2>
      <p>
        HTTP 402, <code>plan_limit_reached</code>, <code>details.window = &quot;daily&quot;</code>.
        Includes <code>limit</code>, <code>usage</code>, <code>dailyCapacity</code>,{" "}
        <code>burstCapacity</code> and <code>passAvailable</code>. A pass adds 1,000 submissions for
        the rest of the UTC day only.
      </p>
      <h2>Monthly allowance exhausted</h2>
      <p>
        HTTP 402, <code>plan_limit_reached</code>,{" "}
        <code>details.window = &quot;billing_period&quot;</code>. If credits cover the overage the
        send succeeds and the overage is debited; if not, <code>creditsExhausted: true</code> and{" "}
        <code>creditUnitsRequired</code> are returned.
      </p>
      <h2>Account suspended</h2>
      <p>
        HTTP 403, <code>organization_suspended</code> or <code>organization_abuse_paused</code>. No
        plan, credit balance or burst pass can override this state.
      </p>
      <h2>Payment errors</h2>
      <ul>
        <li>
          <code>usd_not_enabled</code> — the merchant account cannot take USD; Calder refuses rather
          than converting currency.
        </li>
        <li>
          <code>payments_unavailable</code> — payments are not configured in this environment.
        </li>
        <li>
          <code>payment_pending</code> — Paystack has not confirmed the charge yet.
        </li>
        <li>
          <code>payment_failed</code> — the charge failed; nothing was granted.
        </li>
        <li>
          <code>invalid_signature</code> — a webhook did not carry a valid HMAC-SHA512 signature.
        </li>
      </ul>
      <p>
        See the repository <code>docs/API-LIMITS.md</code> for exact JSON examples.
      </p>
    </>
  );
}
