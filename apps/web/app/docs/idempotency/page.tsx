import type { Metadata } from "next";

export const metadata: Metadata = {
 title: "Idempotency, Calder Docs",
 description: "How Idempotency-Key works, when to use it, and how long keys are honored.",
};

export default function Idempotency() {
 return (
 <>
 <h1>Idempotency</h1>
 <p className="docs-lede">
 Networks fail mid-request. Your code retries. Without idempotency, your user gets two
 receipts. With it, the retry returns the original result.
 </p>

 <h2>How it works</h2>
 <p>
 Send <span className="mono">Idempotency-Key: &lt;unique-value&gt;</span> with{" "}
 <span className="mono">POST /v1/emails</span>. The first request stores its result durably,
 scoped to your project. Repeating the key within <b>24 hours</b> returns the stored result
 with a <span className="mono">200</span>, no second email, no second charge, no second
 meter tick.
 </p>

 <h2>When to use it</h2>
 <p>
 Always, on every send. Generate UUIDs per logical operation (one per user action, not one
 per retry attempt), and for recurring jobs use dated keys like{" "}
 <span className="mono">invoice-run-2026-09-06</span> so a retried cron replays instead of
 duplicating.
 </p>

 <h2>What it doesn&rsquo;t do</h2>
 <p>
 Different keys are different operations, a new key always sends. And idempotency covers
 acceptance, not outcomes: if the email later bounces, that&rsquo;s a delivery event, not a
 duplicate.
 </p>
 </>
 );
}
