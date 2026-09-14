import type { Metadata } from "next";
import { CodeBlock } from "../../../components/code";

export const metadata: Metadata = {
  title: "Webhooks, Calder Docs",
  description: "Receive, verify, and handle Calder event webhooks reliably.",
};

export default function WebhooksGuide() {
  return (
    <>
      <h1>Webhooks</h1>
      <p className="docs-lede">
        Register an HTTPS endpoint and we&rsquo;ll POST every lifecycle event to it, signed,
        timestamped, and retried until you acknowledge it.
      </p>

      <div className="docs-note">
        <strong>What fires today.</strong> Webhook deliveries are emitted for{" "}
        <span className="mono">email.sent</span> and <span className="mono">email.failed</span>.
        Provider-side signals (<span className="mono">email.delivered</span>,{" "}
        <span className="mono">email.bounced</span>, <span className="mono">email.complained</span>)
        and tracking events (<span className="mono">email.opened</span>,{" "}
        <span className="mono">email.clicked</span>) are recorded on our roadmap and land behind the
        same endpoint without a second integration. Subscribe to them now if you like, the shapes
        are fixed.
      </div>

      <h2>1. Register an endpoint</h2>
      <CodeBlock
        title="register"
        copyText={`curl https://api.calder.click/v1/webhooks -H "Authorization: Bearer calder_sk_live_…" -d '{"url":"https://acme.com/hooks/calder", "events":["email.delivered", "email.bounced"]}'`}
      >
        <span className="tok-dim">$</span> <span className="tok-key">curl</span>{" "}
        <span className="tok-path">https://api.calder.click/v1/webhooks</span>
        {"\n"}
        &nbsp;&nbsp;<span className="tok-dim">-d</span>{" "}
        <span className="tok-str">
          &apos;{"{"}&quot;url&quot;:&quot;https://acme.com/hooks/calder&quot;, …{"}"}&apos;
        </span>
      </CodeBlock>
      <p>You&rsquo;ll get a signing secret. Store it, it&rsquo;s shown once.</p>

      <h2>2. Verify signatures</h2>
      <p>
        Every delivery includes a signature header computed as{" "}
        <span className="mono">HMAC-SHA256(secret, raw_body)</span>. Compare with{" "}
        <span className="mono">timingSafeEqual</span>, never <span className="mono">===</span>.
        Reject anything that doesn&rsquo;t verify, shape alone is never trust.
      </p>

      <h2>3. Handle idempotently</h2>
      <p>
        We retry failed deliveries with backoff, so your handler will sometimes see the same event
        twice. Dedupe on the event ID, return <span className="mono">200</span> fast, and do slow
        work (emails, database writes) after acknowledging.
      </p>

      <h2>4. Inspect and replay</h2>
      <p>
        Every attempt is logged with status code, latency, and error. After an outage on your side,
        replay missed deliveries from the dashboard instead of asking us what happened.
      </p>

      <div className="docs-note">
        <strong>Respond quickly.</strong> Acknowledge within a few seconds. If your handler needs a
        minute, accept first and process asynchronously, same philosophy as our API.
      </div>
    </>
  );
}
