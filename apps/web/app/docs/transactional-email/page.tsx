import Link from "next/link";
import { pageMeta } from "../../../lib/seo";

export const metadata = pageMeta({
  title: "Transactional Email API: A Practical Guide",
  description:
    "Learn how to send verification emails, receipts, and notifications with an email API, from a test request to delivery events.",
  path: "/docs/transactional-email",
});

export default function TransactionalEmailGuide() {
  return (
    <>
      <h1>Transactional email API: a practical guide</h1>
      <p className="docs-lede">
        Transactional emails are messages triggered by an individual action or account event:
        verification codes, password resets, receipts, and security alerts. An email API lets your
        application request those messages over HTTPS rather than maintaining a mail server.
      </p>
      <h2>What happens when your app sends an email?</h2>
      <p>
        Your backend sends a request with a sender, recipient, subject and message body. Calder
        validates and queues the request, then processes it for delivery. A{" "}
        <code>202 Accepted</code> response means the request was queued; it is not proof that the
        recipient received it. Follow the message ID and delivery events to see what happened next.
      </p>
      <h2>Start with a test key</h2>
      <ol>
        <li>
          Create a project and a test API key. Keep the key on your server, not in browser code or a
          public repository.
        </li>
        <li>
          Send a request using the <Link href="/docs/quickstart/curl">cURL quickstart</Link> or a
          language-specific HTTP example. Test keys simulate the pipeline and do not deliver real
          mail.
        </li>
        <li>
          Use an idempotency key for each logical operation so retries can be replayed safely. See{" "}
          <Link href="/docs/idempotency">idempotency</Link>.
        </li>
        <li>
          When you are ready for live sending, set up an eligible sender and verify your domain.
          Delivery depends on the configured provider and identity status.
        </li>
      </ol>
      <h2>What should you monitor?</h2>
      <p>
        Watch for queued, sent, delivered, bounced and failed events, and use signed webhooks to
        update your own application. A provider accepting a message is different from a recipient
        server accepting it; even a delivered event does not guarantee inbox placement. Learn how to{" "}
        <Link href="/docs/email-delivery-troubleshooting">diagnose delivery problems</Link>.
      </p>
      <h2>Is this the same as a business inbox?</h2>
      <p>
        No. A transactional email API is for application-generated mail; it does not replace a
        mailbox for reading and replying to everyday business email. Calder&rsquo;s Gmail connection
        is an implemented integration whose production approval and availability have not yet been
        verified. See <Link href="/docs/availability">current availability</Link>.
      </p>
      <h2>What does it cost?</h2>
      <p>
        The free plan includes a monthly email allowance and a small Calder footer on outgoing
        messages. Paid checkout is not currently available; see{" "}
        <Link href="/pricing">pricing and current limits</Link> for the latest details.
      </p>
    </>
  );
}
