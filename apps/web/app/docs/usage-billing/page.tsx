import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  alternates: { canonical: "https://calder.click/docs/usage-billing" },
  title: "Usage & Billing Status, Calder Docs",
  description: "How Calder counts usage, limits sends, and sells prepaid capacity.",
};

export default function UsageBilling() {
  return (
    <>
      <h1>Usage &amp; Billing Status</h1>
      <p className="docs-lede">
        Calder prices in US dollars and enforces hard monthly and daily limits. There are no
        automatic overage charges. When a limit is reached, sending pauses and the API returns a
        stable error that names the limit, your usage and the reset time.
      </p>
      <h2>What the counters mean</h2>
      <ul>
        <li>
          Accepted live sends count toward the current period’s sending cap, including queued mail.
        </li>
        <li>
          Provider-accepted sends are recorded in the usage ledger. Provider acceptance is not inbox
          delivery.
        </li>
        <li>
          Test-key sends are excluded from live-send metering. Idempotent replays and delivery
          retries do not create a new chargeable send.
        </li>
      </ul>
      <p>Usage counters are not an invoice, and a 202 response is not confirmation of delivery.</p>
      <h2>Plans</h2>
      <p>
        Beginner is free with 5,000 emails a month and 500 submissions a day. Starter is $5 for
        10,000 and 2,000 a day; Pro is $18 for 50,000 and 5,000 a day. Monthly subscriptions bill
        in USD through Paystack until cancelled.
      </p>
      <h2>Monthly credits</h2>
      <p>
        Prepaid packs add capacity after your included monthly allowance is used: 1,000 emails for
        $2, 3,000 for $5, or 10,000 for $15. Credits carry forward, each purchase expires 12 months
        after you buy it, and credits never extend your daily limit. There is no auto-purchase.
      </p>
      <h2>Daily Burst Passes</h2>
      <p>
        A $1 Daily Burst Pass adds 1,000 submissions for the rest of the current UTC day. It
        expires at 23:59:59 UTC, does not roll over, adds no monthly credits, and is capped at two
        per account per UTC day. It cannot bypass your monthly allowance, a suspension, compliance
        checks, provider limits, or anti-abuse controls.
      </p>
      <h2>When you reach a limit</h2>
      <p>
        The API returns <code>plan_limit_reached</code> with a <code>window</code> of{" "}
        <code>daily</code> or <code>billing_period</code>, plus the limit, usage and reset time. A
        daily refusal may offer a Daily Burst Pass; a monthly refusal may require credits. See{" "}
        <Link href="/docs/errors">error responses</Link> for the exact bodies.
      </p>
      <h2>Sending verification</h2>
      <p>
        Live sends require an eligible sender and configured delivery infrastructure. See the{" "}
        <Link href="/docs/domains">domain guide</Link> and{" "}
        <Link href="/docs/sending">sending guide</Link>. Delivery events, where configured, provide
        outcomes beyond queue/provider acceptance.
      </p>
    </>
  );
}
