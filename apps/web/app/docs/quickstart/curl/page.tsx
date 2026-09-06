import type { Metadata } from "next";
import Link from "next/link";
import { CodeBlock } from "../../../../components/code";

export const metadata: Metadata = {
  title: "Quickstart: cURL — Avenor Docs",
  description: "Send your first Avenor email with raw HTTP and cURL.",
};

const CODE = `curl https://api.avenor.com/v1/emails \\
  -H "Authorization: Bearer avenor_sk_test_…" \\
  -H "Idempotency-Key: hello-001" \\
  -H "Content-Type: application/json" \\
  -d '{
    "from": "app@acme.com",
    "to": "you@example.com",
    "subject": "Hello from Avenor",
    "text": "It works."
  }'`;

export default function CurlQuickstart() {
  return (
    <>
      <h1>Quickstart: cURL</h1>
      <p className="docs-lede">
        The API is plain HTTPS and JSON — if you can curl it, you can use it from anything.
      </p>
      <CodeBlock title="terminal" copyText={CODE}>
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
        &nbsp;&nbsp;<span className="tok-dim">-H</span>{" "}
        <span className="tok-str">&quot;Content-Type: application/json&quot;</span>{" "}
        <span className="tok-dim">\</span>
        {"\n"}
        &nbsp;&nbsp;<span className="tok-dim">-d</span>{" "}
        <span className="tok-str">
          &apos;{"{"}&quot;from&quot;:&quot;app@acme.com&quot;, …{"}"}&apos;
        </span>
      </CodeBlock>
      <p>
        Expect{" "}
        <span className="mono">
          {"{"}&quot;id&quot;: &quot;em_…&quot;, &quot;status&quot;: &quot;queued&quot;{"}"}
        </span>{" "}
        back with HTTP <span className="mono">202</span>. Re-run the identical command and
        you&rsquo;ll get the original result with a <span className="mono">200</span> — try it,
        that&rsquo;s idempotency working. Then read{" "}
        <Link href="/docs/api-reference">the full reference</Link>.
      </p>
    </>
  );
}
