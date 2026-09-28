import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Core concepts, Calder Docs",
  description:
    "The ideas behind Calder: lifecycle, async delivery, idempotency, events, and suppression.",
};

export default function Concepts() {
  return (
    <>
      <h1>Core concepts</h1>
      <p className="docs-lede">
        Five ideas explain almost everything Calder does. Learn them once and the API, the dashboard
        and the webhooks all read the same way.
      </p>

      <h2>1. The email lifecycle</h2>
      <p>
        An email moves through{" "}
        <span className="mono">created → queued → sending → sent → delivered</span>. It can also end
        early at <span className="mono">bounced</span>, <span className="mono">failed</span> or{" "}
        <span className="mono">complained</span>. Every transition is stored as an event you can
        query, and the dashboard timeline is that list rendered.
      </p>

      <h2>2. Async by default</h2>
      <p>
        <span className="mono">POST /v1/emails</span> validates the request, writes it down, queues
        it and answers <span className="mono">202</span> in milliseconds. A background worker
        handles delivery and retries. Nothing in your request path ever waits on a mail server,
        which is what keeps your latency independent of ours.
      </p>

      <h2>3. Idempotency</h2>
      <p>
        Networks fail mid-request and clients retry. The{" "}
        <span className="mono">Idempotency-Key</span> header makes that safe: the first request
        stores its result, and a repeat of the same key returns it instead of sending again.
      </p>

      <h2>4. Events and webhooks</h2>
      <p>
        Every lifecycle transition emits an event (<span className="mono">email.sent</span>,{" "}
        <span className="mono">email.delivered</span>, …). Events fan out to your webhook endpoints
        signed and retried. If you can handle webhooks, you can build on- delivery onboarding,
        on-bounce cleanup, and on-complaint suppression without polling us.
      </p>

      <h2>5. Suppression</h2>
      <p>
        Addresses that bounced, complained, or unsubscribed are blocked before sending, with a
        logged reason, never silence. Suppression protects your domain reputation automatically; the
        dashboard shows you exactly who is suppressed and why.
      </p>

      <div className="docs-note">
        <strong>One model, everywhere.</strong> The dashboard, the API, and your webhooks all speak
        lifecycle. Learn more in the <Link href="/docs/api-reference">API reference</Link>.
      </div>
    </>
  );
}
