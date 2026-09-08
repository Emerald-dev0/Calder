import type { Metadata } from "next";
import Link from "next/link";
import { CodeBlock } from "../../../components/code";

export const metadata: Metadata = {
  title: "Sending — Calder Docs",
  description: "How the Calder email API works end to end: request, response, and idempotency.",
};

export default function Sending() {
  return (
    <>
      <h1>Sending</h1>
      <p className="docs-lede">
        One endpoint, one decision that matters: give every send an idempotency key, and the rest —
        queueing, retries, events — happens on our side.
      </p>

      <h2>The request</h2>
      <p>
        <span className="mono">POST /v1/emails</span> with <span className="mono">from</span>,{" "}
        <span className="mono">to</span>, <span className="mono">subject</span>, and{" "}
        <span className="mono">html</span> or <span className="mono">text</span>. Authenticate with
        a Bearer key; test keys simulate the pipeline without delivering.
      </p>

      <h2>The response</h2>
      <CodeBlock title="202 Accepted">
        <span className="tok-punct">{"{"}</span>
        {"\n"}
        &nbsp;&nbsp;<span className="tok-key">&quot;id&quot;</span>:{" "}
        <span className="tok-str">&quot;em_9f2k41xq&quot;</span>,{"\n"}
        &nbsp;&nbsp;<span className="tok-key">&quot;status&quot;</span>:{" "}
        <span className="tok-str">&quot;queued&quot;</span>,{"\n"}
        &nbsp;&nbsp;<span className="tok-key">&quot;message&quot;</span>:{" "}
        <span className="tok-str">&quot;Email queued for delivery&quot;</span>
        {"\n"}
        <span className="tok-punct">{"}"}</span>
      </CodeBlock>
      <p>
        <span className="mono">202</span>, not <span className="mono">200</span>: accepted for
        delivery, not yet delivered. The <span className="mono">id</span> tracks the email through
        logs, timelines, and webhook payloads forever.
      </p>

      <h2>What happens next</h2>
      <p>
        Validate → persist → enqueue → worker → provider → events. Transient failures retry with
        backoff; permanent ones record a diagnosable error; exhausted jobs wait in a replayable
        dead-letter state. Read <Link href="/docs/concepts">the lifecycle</Link> for the full state
        machine.
      </p>

      <div className="docs-note">
        <strong>Always send an Idempotency-Key.</strong> Timeouts are normal; double-sends
        shouldn&rsquo;t be. <Link href="/docs/idempotency">How it works</Link>.
      </div>
    </>
  );
}
