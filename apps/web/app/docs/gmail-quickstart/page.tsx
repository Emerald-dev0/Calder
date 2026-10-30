import type { Metadata } from "next";
import Link from "next/link";
import { CodeBlock } from "../../../components/code";

export const metadata: Metadata = {
  alternates: { canonical: "https://calder.click/docs/gmail-quickstart" },
  title: "Gmail Quickstart, Calder Docs",
  description:
    "Send your first Calder email with no domain: connect Gmail via OAuth and use the same API as everyone else.",
};

const CODE = `// Node 18+, no dependencies
const res = await fetch("https://api.calder.click/v1/emails", {
 method: "POST",
 headers: {
 Authorization: "Bearer calder_sk_live_…",
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
console.log(res.status); // 202, queued
// Direct HTTP example; official SDK publication is not launch-verified.`;

export default function GmailQuickstart() {
  return (
    <>
      <h1>Gmail Quickstart</h1>
      <p className="docs-lede">
        No domain and no DNS records. Connect a Gmail account you already own and send through the
        same API, logs and events as anyone on a verified domain.
      </p>

      <div className="docs-note">
        <strong>Production availability not verified.</strong> OAuth/transport source exists, but
        Google approval, production credentials and an end-to-end Gmail send have not been confirmed
        for this launch. The steps below describe the implemented flow when configured, not a
        guarantee that every new account can connect today.
      </div>
      <h2>1. Connect Gmail</h2>
      <p>
        In the project dashboard, choose <b>Connect Gmail</b>. Google asks for your verified email
        identity and permission to send mail as you, not permission to read your inbox. Calder never
        sees or stores your Google password; the refresh token is encrypted at rest. You can revoke
        Calder’s access from your Google account.
      </p>

      <h2>2. Send exactly like everyone else</h2>
      <CodeBlock title="send.mjs" copyText={CODE}>
        <span className="tok-dim">{"// Node 18+, no dependencies"}</span>
        {"\n"}
        <span className="tok-key">const</span> <span className="tok-path">res</span>{" "}
        <span className="tok-dim">=</span> <span className="tok-key">await</span>{" "}
        <span className="tok-method">fetch</span>(
        <span className="tok-str">&quot;https://api.calder.click/v1/emails&quot;</span>,{" "}
        <span className="tok-punct">{"{"}</span>
        {"\n"}
        &nbsp;&nbsp;<span className="tok-key">method</span>:{" "}
        <span className="tok-str">&quot;POST&quot;</span>, {"\n"}
        &nbsp;&nbsp;<span className="tok-key">headers</span>:{" "}
        <span className="tok-punct">{"{"}</span>{" "}
        <span className="tok-dim">{"/* key + Idempotency-Key */"}</span>{" "}
        <span className="tok-punct">{"}"}</span>, {"\n"}
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
        <span className="tok-dim">{"// 202, queued. SDKs land with v1."}</span>
      </CodeBlock>

      <p>
        Use a live API key to send a real message. Test keys use a mock transport and do not deliver
        Gmail.
      </p>
      <h2>3. Know the limits (they&rsquo;re the point)</h2>
      <p>
        Gmail sending is capped daily and rate-limited on purpose, it&rsquo;s the on-ramp, not bulk
        infrastructure. When configured, the Senders page shows the account allowance. Hitting it
        regularly is the signal to graduate:
      </p>
      <div className="docs-note">
        <strong>The graduation path.</strong> Buy any domain →{" "}
        <Link href="/docs/domains">verify it</Link> → switch your sender to{" "}
        <span className="mono">hello@yourdomain.com</span>. Same API key, same logs, same templates,
        same code. Nothing rewrites.
      </div>

      <h2>Rules of the road</h2>
      <ul>
        <li>Send only as your connected address, anything else is rejected.</li>
        <li>
          Transactional mail only. Newsletters and bulk sends will get throttled, then suspended.
        </li>
        <li>Revoke access from your Google account when you no longer want Calder to send.</li>
      </ul>
    </>
  );
}
