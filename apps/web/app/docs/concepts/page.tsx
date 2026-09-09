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
 Five ideas explain nearly everything Calder does. Learn them once and the whole platform,
 API, dashboard, webhooks, reads like one coherent system.
 </p>

 <h2>1. The email lifecycle</h2>
 <p>
 Every email moves through states:{" "}
 <span className="mono">created → queued → sending → sent → delivered</span>, with{" "}
 <span className="mono">bounced</span>, <span className="mono">complained</span>, and{" "}
 <span className="mono">failed</span> as terminal detours. Opens and clicks attach after
 delivery. Each transition is recorded as an event you can query, the timeline in your
 dashboard is this lifecycle, rendered.
 </p>

 <h2>2. Async by default</h2>
 <p>
 <span className="mono">POST /v1/emails</span> validates, persists, enqueues, and answers{" "}
 <span className="mono">202</span> in milliseconds. Delivery happens in a background worker
 with retries. Your request path never waits on a mail server, that separation is the single
 most important architectural decision in the system.
 </p>

 <h2>3. Idempotency</h2>
 <p>
 Networks fail mid-request, and clients retry. The{" "}
 <span className="mono">Idempotency-Key</span> header makes retries safe: the first request
 stores its result, repeats return the original. Anything that could cause harm if duplicated
, sends, charges, requires one.
 </p>

 <h2>4. Events and webhooks</h2>
 <p>
 Every lifecycle transition emits an event (<span className="mono">email.sent</span>, {" "}
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
