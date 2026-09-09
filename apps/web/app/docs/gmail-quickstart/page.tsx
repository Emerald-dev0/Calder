import type { Metadata } from "next";
import Link from "next/link";
import { CodeBlock } from "../../../components/code";

export const metadata: Metadata = {
  title: "Gmail Quickstart — Calder Docs",
  description:
    "Send your first Calder email with no domain: connect Gmail via OAuth and use the same API as everyone else.",
};

const CODE = `// Node 18+, no dependencies
const res = await fetch("https://api.calder.com/v1/emails", {
  method: "POST",
  headers: {
    Authorization: "Bearer calder_sk_test_…",
    "Idempotency-Key": crypto.randomUUID(),
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    from: "myproject@gmail.com", // your connected address
    to: "customer@example.com",
    subject: "Welcome!",
    html: "<h1>Welcome!</h1>",
  }),
});
console.log(res.status); // 202 — queued
// SDKs (npm install calder) land with v1; this API is stable now.`;

export default function GmailQuickstart() {
  return (
    <>
      <h1>Gmail Quickstart</h1>
      <p className="docs-lede">
        No domain, no DNS, no SMTP settings. Connect the Gmail account you already have and send
        through the same API, logs, and events as production senders.
      </p>

      <h2>1. Connect Gmail</h2>
      <p>
        In your project dashboard, choose <b>Connect Gmail</b> (rolling out to early access projects
        now). Google asks for one permission — sending mail on your behalf — and nothing else. We
        never see, ask for, or store your Google password; the authorization token is encrypted at
        rest and you can revoke it anytime from either side.
      </p>

      <h2>2. Send exactly like everyone else</h2>
      <CodeBlock title="send.mjs" copyText={CODE}>
        <span className="tok-dim">{"// Node 18+, no dependencies"}</span>
        {"\n"}
        <span className="tok-key">const</span> <span className="tok-path">res</span>{" "}
        <span className="tok-dim">=</span> <span className="tok-key">await</span>{" "}
        <span className="tok-method">fetch</span>(
        <span className="tok-str">&quot;https://api.calder.com/v1/emails&quot;</span>,{" "}
        <span className="tok-punct">{"{"}</span>
        {"\n"}
        &nbsp;&nbsp;<span className="tok-key">method</span>:{" "}
        <span className="tok-str">&quot;POST&quot;</span>,{"\n"}
        &nbsp;&nbsp;<span className="tok-key">headers</span>:{" "}
        <span className="tok-punct">{"{"}</span>{" "}
        <span className="tok-dim">{"/* key + Idempotency-Key */"}</span>{" "}
        <span className="tok-punct">{"}"}</span>,{"\n"}
        &nbsp;&nbsp;<span className="tok-key">body</span>:{" "}
        <span className="tok-method">JSON.stringify</span>(<span className="tok-punct">{"{"}</span>
        {"\n"}
        &nbsp;&nbsp;&nbsp;&nbsp;<span className="tok-key">from</span>:{" "}
        <span className="tok-str">&quot;myproject@gmail.com&quot;</span>,{" "}
        <span className="tok-dim">{"// your connected address"}</span>
        {"\n"}
        &nbsp;&nbsp;&nbsp;&nbsp;<span className="tok-key">to</span>:{" "}
        <span className="tok-str">&quot;customer@example.com&quot;</span>,{" "}
        <span className="tok-dim">{"/* subject, html */"}</span>
        {"\n"}
        &nbsp;&nbsp;<span className="tok-punct">{"}"}</span>),
        {"\n"}
        <span className="tok-punct">{"}"}</span>);
        {"\n"}
        <span className="tok-dim">{"// 202 — queued. SDKs land with v1."}</span>
      </CodeBlock>

      <h2>3. Know the limits (they&rsquo;re the point)</h2>
      <p>
        Gmail sending is capped daily and rate-limited on purpose — it&rsquo;s the on-ramp, not bulk
        infrastructure. Your dashboard always shows usage against the cap before you hit it. Hitting
        it regularly is the signal to graduate:
      </p>
      <div className="docs-note">
        <strong>The graduation path.</strong> Buy any domain →{" "}
        <Link href="/docs/domains">verify it</Link> → switch your sender to{" "}
        <span className="mono">hello@yourdomain.com</span>. Same API key, same logs, same templates,
        same code. Nothing rewrites.
      </div>

      <h2>Rules of the road</h2>
      <ul>
        <li>Send only as your connected address — anything else is rejected.</li>
        <li>
          Transactional mail only. Newsletters and bulk sends will get throttled, then suspended.
        </li>
        <li>Revoking in Google or in Calder takes effect immediately.</li>
      </ul>
    </>
  );
}
