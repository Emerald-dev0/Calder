import type { Metadata } from "next";
import Link from "next/link";
import { CodeBlock } from "../../../components/code";

export const metadata: Metadata = {
  title: "Quickstart — Avenor Docs",
  description: "Send your first email with Avenor in about five minutes.",
};

export default function Quickstart() {
  return (
    <>
      <h1>Quickstart</h1>
      <p className="docs-lede">
        Five minutes, three steps, zero credit cards. You&rsquo;ll end with a delivered email and a
        webhook to prove it.
      </p>

      <h2>1. Get a test key</h2>
      <p>
        Create a project in the dashboard and copy a <b>test</b> key. Test keys run the full
        pipeline — validation, queue, provider simulation, events, webhooks — without delivering
        anything real. They look like this:
      </p>
      <CodeBlock title="your key">
        <span className="tok-str">avenor_sk_test_7f3a9c…</span>
      </CodeBlock>

      <h2>2. Send your first email</h2>
      <CodeBlock
        title="terminal"
        copyText={`curl https://api.avenor.com/v1/emails -H "Authorization: Bearer avenor_sk_test_…" -H "Idempotency-Key: hello-001" -d '{"from":"app@acme.com","to":"you@example.com","subject":"Hello from Avenor","text":"It works."}'`}
      >
        <span className="tok-dim">$</span> <span className="tok-key">curl</span>{" "}
        <span className="tok-path">https://api.avenor.com/v1/emails</span>{" "}
        <span className="tok-dim">\</span>
        {"\n"}
        &nbsp;&nbsp;<span className="tok-dim">-H</span>{" "}
        <span className="tok-str">&quot;Authorization: Bearer avenor_sk_test_…&quot;</span>{" "}
        <span className="tok-dim">\</span>
        {"\n"}
        &nbsp;&nbsp;<span className="tok-dim">-H</span>{" "}
        <span className="tok-str">&quot;Idempotency-Key: hello-001&quot;</span>{" "}
        <span className="tok-dim">\</span>
        {"\n"}
        &nbsp;&nbsp;<span className="tok-dim">-d</span>{" "}
        <span className="tok-str">
          &apos;{"{"}&quot;from&quot;:&quot;app@acme.com&quot;,…{"}"}&apos;
        </span>
      </CodeBlock>
      <p>
        You&rsquo;ll get a <span className="mono">202 Accepted</span> with an email id in
        milliseconds. The <span className="mono">Idempotency-Key</span> means you can retry this
        exact request safely — same key, same result, one email.
      </p>

      <h2>3. Watch it land</h2>
      <p>
        Check the dashboard log for your email&rsquo;s timeline: queued → sent → delivered. Then add
        a webhook endpoint and send again — you&rsquo;ll receive a signed{" "}
        <span className="mono">email.delivered</span> event. That&rsquo;s the whole loop.
      </p>

      <div className="docs-note">
        <strong>Going live.</strong> Verify a sending domain under{" "}
        <Link href="/domains">Domains</Link>, swap your test key for a live one, and keep the same
        code. Nothing else changes.
      </div>

      <h2>Next steps</h2>
      <ul>
        <li>
          <Link href="/docs/concepts">Core concepts</Link> — the lifecycle and why it matters
        </li>
        <li>
          <Link href="/docs/api-reference">API reference</Link> — every endpoint and error
        </li>
        <li>
          <Link href="/docs/webhooks">Webhooks</Link> — verify and handle events
        </li>
      </ul>
    </>
  );
}
