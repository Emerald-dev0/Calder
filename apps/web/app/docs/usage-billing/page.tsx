import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Usage & Billing, Calder Docs",
  description:
    "How usage is metered, what counts against your plan, and pricing in naira and dollars.",
};

export default function UsageBilling() {
  return (
    <>
      <h1>Usage &amp; Billing</h1>
      <p className="docs-lede">
        One accepted send is one unit. Everything else, webhooks, reads, retries, test traffic, is
        free forever.
      </p>

      <h2>How usage is metered</h2>
      <p>
        A <span className="mono">202 Accepted</span> from{" "}
        <span className="mono">POST /v1/emails</span> is the billable moment. Usage is aggregated
        from durable email and event records on a schedule, never from frontend counters, never
        estimated. Idempotent replays and provider retries don&rsquo;t double-count.
      </p>

      <h2>Plans</h2>
      <p>
        Beginner is free: 5,000 emails a month, 3 projects, 2 domains. Pro is $15 or ₦25,000 for
        50,000 sends. Premium is $49 or ₦75,000 for 250,000. Scale is custom volume and pricing.
        Naira and dollar prices are set separately, not converted from one another, full detail on
        the <Link href="/pricing">pricing page</Link>.
      </p>

      <h2>Limits, not overages</h2>
      <p>
        Hitting your quota pauses sending with a clear{" "}
        <span className="mono">PLAN_LIMIT_REACHED</span> error that names your limit, your usage and
        when it resets, never a surprise line item. Upgrade or wait for the cycle reset; the
        dashboard shows exactly where you stand at all times.
      </p>
    </>
  );
}
