import type { Metadata } from "next";
import Link from "next/link";
import { CodeBlock } from "../../../components/code";

export const metadata: Metadata = {
  title: "Examples — Calder Docs",
  description: "Real integration examples: Next.js, Express, Hono, and Remix patterns.",
};

export default function Examples() {
  return (
    <>
      <h1>Examples</h1>
      <p className="docs-lede">
        Copy-paste starting points for common stacks. Same API underneath — pick your idiom.
      </p>

      <h2>Next.js Route Handler</h2>
      <CodeBlock
        title="app/api/invite/route.ts"
        copyText={`import { NextResponse } from "next/server";
export async function POST(req: Request) {
  const { email } = await req.json();
  const res = await fetch("https://api.calder.click/v1/emails", {
    method: "POST",
    headers: {
      Authorization: \`Bearer \${process.env.CALDER_API_KEY}\`,
      "Idempotency-Key": \`invite-\${email}\`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: "app@acme.com", to: email, subject: "You're invited", text: "…" }),
  });
  return NextResponse.json(await res.json(), { status: res.status });
}`}
      >
        <span className="tok-key">import</span>{" "}
        <span className="tok-punct">{"{ NextResponse }"}</span>{" "}
        <span className="tok-key">from</span>{" "}
        <span className="tok-str">&quot;next/server&quot;</span>;{"\n\n"}
        <span className="tok-key">export async function</span>{" "}
        <span className="tok-method">POST</span>(<span className="tok-path">req</span>:{" "}
        <span className="tok-path">Request</span>) <span className="tok-punct">{"{"}</span>
        {"\n"}
        &nbsp;&nbsp;<span className="tok-dim">// validate input, then POST to Calder with an</span>
        {"\n"}
        &nbsp;&nbsp;<span className="tok-dim">// Idempotency-Key derived from the recipient.</span>
        {"\n"}
        <span className="tok-punct">{"}"}</span>
      </CodeBlock>

      <h2>Express middleware pattern</h2>
      <p>
        Send inside the request handler but never <span className="mono">await</span> delivery —
        Calder&rsquo;s <span className="mono">202</span> returns in milliseconds, so awaiting the
        POST is safe. Put it after your database write, inside the same logical operation, keyed
        idempotently on the record id.
      </p>

      <h2>Hono (our own stack)</h2>
      <p>
        We run Hono in production, so this one is battle-tested by us daily: a tiny{" "}
        <span className="mono">sendEmail()</span> helper that takes your API key from env, attaches{" "}
        <span className="tok-dim mono">crypto.randomUUID()</span> idempotency keys, and throws typed
        errors on non-2xx. See the <Link href="/docs/quickstart/nodejs">Node.js quickstart</Link>{" "}
        for the exact call.
      </p>

      <h2>Remix action</h2>
      <p>
        Same shape as Next.js: validate with your schema library, POST to Calder in the action,
        return the email id to the client for status polling — or better, skip polling and listen
        for the <Link href="/docs/webhooks">webhook</Link>.
      </p>
    </>
  );
}
