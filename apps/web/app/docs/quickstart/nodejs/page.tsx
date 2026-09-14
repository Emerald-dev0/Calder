import type { Metadata } from "next";
import Link from "next/link";
import { CodeBlock } from "../../../../components/code";

export const metadata: Metadata = {
  title: "Quickstart: Node.js, Calder Docs",
  description: "Send your first Calder email from Node.js with fetch. No SDK required.",
};

const CODE = `const res = await fetch("https://api.calder.click/v1/emails", {
 method: "POST",
 headers: {
 Authorization: "Bearer calder_sk_test_…",
 "Idempotency-Key": crypto.randomUUID(),
 "Content-Type": "application/json",
 },
 body: JSON.stringify({
 from: "app@acme.com",
 to: "you@example.com",
 subject: "Hello from Calder",
 text: "It works.",
 }),
});

const { id, status } = await res.json();
console.log(id, status); // em_9f2k41xq "queued"`;

export default function NodeQuickstart() {
  return (
    <>
      <h1>Quickstart: Node.js</h1>
      <p className="docs-lede">
        Node 18+ has what you need built in. No SDK, no install, just{" "}
        <span className="mono">fetch</span>.
      </p>
      <CodeBlock title="send.mjs" copyText={CODE}>
        <span className="tok-key">const</span> <span className="tok-path">res</span>{" "}
        <span className="tok-dim">=</span> <span className="tok-key">await</span>{" "}
        <span className="tok-method">fetch</span>(
        <span className="tok-str">&quot;https://api.calder.click/v1/emails&quot;</span>,{" "}
        <span className="tok-punct">{"{"}</span>
        {"\n"}
        &nbsp;&nbsp;<span className="tok-key">method</span>:{" "}
        <span className="tok-str">&quot;POST&quot;</span>, {"\n"}
        &nbsp;&nbsp;<span className="tok-key">headers</span>:{" "}
        <span className="tok-punct">{"{"}</span>
        {"\n"}
        &nbsp;&nbsp;&nbsp;&nbsp;<span className="tok-key">Authorization</span>:{" "}
        <span className="tok-str">&quot;Bearer calder_sk_test_…&quot;</span>, {"\n"}
        &nbsp;&nbsp;&nbsp;&nbsp;<span className="tok-str">&quot;Idempotency-Key&quot;</span>:{" "}
        <span className="tok-path">crypto.randomUUID</span>(),
        {"\n"}
        &nbsp;&nbsp;&nbsp;&nbsp;<span className="tok-str">&quot;Content-Type&quot;</span>:{" "}
        <span className="tok-str">&quot;application/json&quot;</span>, {"\n"}
        &nbsp;&nbsp;<span className="tok-punct">{"}"}</span>, {"\n"}
        &nbsp;&nbsp;<span className="tok-key">body</span>:{" "}
        <span className="tok-method">JSON.stringify</span>(<span className="tok-punct">{"{"}</span>
        {"\n"}
        &nbsp;&nbsp;&nbsp;&nbsp;<span className="tok-key">from</span>:{" "}
        <span className="tok-str">&quot;app@acme.com&quot;</span>, {"\n"}
        &nbsp;&nbsp;&nbsp;&nbsp;<span className="tok-key">to</span>:{" "}
        <span className="tok-str">&quot;you@example.com&quot;</span>, {"\n"}
        &nbsp;&nbsp;&nbsp;&nbsp;<span className="tok-key">subject</span>:{" "}
        <span className="tok-str">&quot;Hello from Calder&quot;</span>, {"\n"}
        &nbsp;&nbsp;&nbsp;&nbsp;<span className="tok-key">text</span>:{" "}
        <span className="tok-str">&quot;It works.&quot;</span>, {"\n"}
        &nbsp;&nbsp;<span className="tok-punct">{"}"}</span>),
        {"\n"}
        <span className="tok-punct">{"}"}</span>);
      </CodeBlock>
      <p>
        Run it with <span className="mono">node send.mjs</span>. A <span className="mono">202</span>{" "}
        means queued; watch the timeline in your dashboard, then read{" "}
        <Link href="/docs/webhooks">Webhooks</Link> to get pinged on delivery.
      </p>
    </>
  );
}
