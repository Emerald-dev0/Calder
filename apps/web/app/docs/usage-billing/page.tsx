import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Usage & Billing — Avenor Docs",
  description: "How usage is metered, what counts, plans in NGN and USD.",
};

export default function UsageBilling() {
  return (
    <>
      <h1>Usage &amp; Billing</h1>
      <p className="docs-lede">
        One accepted send is one unit. Everything else — webhooks, reads, retries, test traffic — is
        free forever.
      </p>

      <h2>How usage is metered</h2>
      <p>
        A <span className="mono">202 Accepted</span> from{" "}
        <span className="mono">POST /v1/emails</span> is the billable moment. Usage is aggregated
        from durable email and event records on a schedule — never from frontend counters, never
        estimated. Idempotent replays and provider retries don&rsquo;t double-count.
      </p>

      <h2>Plans</h2>
      <p>
        Free (3,000/mo), Starter (₦5,000 / $7 — 25,000), Pro (₦12,000 / $15 — 100,000), Scale
        (₦45,000 / $50 — 500,000). Full detail on the <Link href="/pricing">pricing page</Link>.
      </p>

      <h2>Limits, not overages</h2>
      <p>
        Hitting your quota pauses sending with a clear{" "}
        <span className="mono">rate_limit_error</span> — never a surprise line item. Upgrade or wait
        for the cycle reset; the dashboard shows exactly where you stand at all times.
      </p>
    </>
  );
}
