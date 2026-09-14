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
        A request that times out may still have succeeded, so retrying it can send the same email
        twice. An idempotency key makes that retry return the original result instead.
      </p>

      <h2>How it works</h2>
      <p>
        Send <span className="mono">Idempotency-Key: &lt;unique-value&gt;</span> with{" "}
        <span className="mono">POST /v1/emails</span>. The first request stores its result against
        your project. Repeating the key within <b>24 hours</b> returns that stored result with a{" "}
        <span className="mono">200</span>: one email, one billable send.
      </p>

      <h2>When to use it</h2>
      <p>
        On every send. Generate the key per logical operation, one per user action rather than one
        per retry attempt. For scheduled work, derive it from the run itself, e.g.{" "}
        <span className="mono">invoice-run-2026-09-06</span>, so a cron that fires twice replays
        instead of duplicating.
      </p>

      <h2>What it doesn&rsquo;t do</h2>
      <p>
        A new key always sends; two different keys are two different operations. Idempotency also
        covers acceptance only. If the message later bounces, that is a delivery event with its own
        record, not a duplicate send.
      </p>
    </>
  );
}
