import Link from "next/link";
import { pageMeta } from "../../../lib/seo";

export const metadata = pageMeta({
  title: "Email Delivery Troubleshooting: Queued, Sent, Bounced",
  description:
    "Diagnose transactional email delivery: distinguish queued, sent and delivered, check sender readiness, suppressions and webhook events.",
  path: "/docs/email-delivery-troubleshooting",
});

export default function DeliveryTroubleshooting() {
  return (
    <>
      <h1>Email delivery troubleshooting</h1>
      <p className="docs-lede">
        A successful API request is the beginning of delivery, not the end. Use the message ID and
        event history to find where the message stopped before retrying or changing DNS.
      </p>
      <h2>First, identify the state</h2>
      <ul>
        <li>
          <strong>Queued:</strong> the request was accepted for processing, not delivered. Check the
          message timeline and the current service status; a delayed send may be scheduled for
          later.
        </li>
        <li>
          <strong>Sent:</strong> the delivery provider accepted the message. This alone does not
          prove a recipient server accepted it.
        </li>
        <li>
          <strong>Delivered:</strong> a provider delivery event indicates acceptance by the
          recipient server; it does not guarantee placement in the inbox.
        </li>
        <li>
          <strong>Bounced, suppressed or failed:</strong> inspect the recorded reason before
          attempting another send. Do not repeatedly send to an address that has bounced or
          complained.
        </li>
      </ul>
      <h2>Check the sender and environment</h2>
      <p>
        Test API keys simulate sending and never deliver real email. For live traffic, check the
        sender identity, domain ownership, provider sending identity and DKIM status. Domain
        ownership and provider readiness are separate checks. See{" "}
        <Link href="/docs/domains">domain setup</Link> and{" "}
        <Link href="/docs/deliverability">deliverability</Link>.
      </p>
      <h2>Check suppression and event delivery</h2>
      <p>
        Calder checks suppression before delivery. A bounce or complaint can block future sends; an
        unsubscribe applies to marketing traffic. Review the{" "}
        <Link href="/docs/suppression">suppression guide</Link> before changing a record. Delivery
        events and webhooks depend on provider feedback being configured; a missing event alone is
        not proof of delivery or non-delivery.
      </p>
      <h2>Retry safely</h2>
      <p>
        Use the same idempotency key when retrying the same logical API request after a timeout. A
        new send is a new operation and can result in another email. For provider failures, consult
        the message timeline and the <Link href="/docs/idempotency">idempotency guide</Link> before
        retrying.
      </p>
      <h2>Still stuck?</h2>
      <p>
        Check <Link href="/docs/availability">launch availability</Link> and{" "}
        <Link href="/status">service status</Link>, then contact{" "}
        <Link href="/support">support</Link> with the request ID and message ID. Do not share API
        keys, tokens, or sensitive email content.
      </p>
    </>
  );
}
