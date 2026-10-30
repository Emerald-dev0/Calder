import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  alternates: { canonical: "https://calder.click/docs/usage-billing" },
  title: "Usage & Billing Status, Calder Docs",
  description: "Current usage limits and billing availability for the initial public launch.",
};

export default function UsageBilling() {
  return (
    <>
      <h1>Usage &amp; Billing Status</h1>
      <p className="docs-lede">
        Paid checkout, subscriptions, and self-service upgrades are not available yet. Current
        sending and resource limits still apply; this is not unlimited sending.
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
      <h2>When you reach a limit</h2>
      <p>
        The API can return <code>plan_limit_reached</code> with limit and period details. Check your
        organization’s current Usage page. Wait for the period reset or contact
        support@calder.click; do not rely on an upgrade checkout being available.
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
