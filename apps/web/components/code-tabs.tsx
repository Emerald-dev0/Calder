"use client";

import * as React from "react";
import { CodeBlock } from "./code";

const SNIPPETS = {
  cURL: {
    title: "request.sh — send an email",
    copy: `curl https://api.calder.com/v1/emails \\
  -H "Authorization: Bearer calder_sk_live_…" \\
  -H "Idempotency-Key: welcome-user-4815" \\
  -d '{
    "from": "app@acme.com",
    "to": "ada@example.com",
    "subject": "Verify your email",
    "html": "<p>Your code is <b>482 915</b></p>"
  }'`,
    body: (
      <>
        <span className="tok-dim">$</span> <span className="tok-key">curl</span>{" "}
        <span className="tok-path">https://api.calder.com/v1/emails</span>{" "}
        <span className="tok-dim">\</span>
        {"\n"}
        &nbsp;&nbsp;<span className="tok-dim">-H</span>{" "}
        <span className="tok-str">&quot;Authorization: Bearer calder_sk_live_…&quot;</span>{" "}
        <span className="tok-dim">\</span>
        {"\n"}
        &nbsp;&nbsp;<span className="tok-dim">-H</span>{" "}
        <span className="tok-str">&quot;Idempotency-Key: welcome-user-4815&quot;</span>{" "}
        <span className="tok-dim">\</span>
        {"\n"}
        &nbsp;&nbsp;<span className="tok-dim">-d</span> <span className="tok-str">&apos;{"{"}</span>
        {"\n"}
        &nbsp;&nbsp;&nbsp;&nbsp;<span className="tok-key">&quot;from&quot;</span>:{" "}
        <span className="tok-str">&quot;app@acme.com&quot;</span>,{"\n"}
        &nbsp;&nbsp;&nbsp;&nbsp;<span className="tok-key">&quot;to&quot;</span>:{" "}
        <span className="tok-str">&quot;ada@example.com&quot;</span>,{"\n"}
        &nbsp;&nbsp;&nbsp;&nbsp;<span className="tok-key">&quot;subject&quot;</span>:{" "}
        <span className="tok-str">&quot;Verify your email&quot;</span>,{"\n"}
        &nbsp;&nbsp;&nbsp;&nbsp;<span className="tok-key">&quot;html&quot;</span>:{" "}
        <span className="tok-str">&quot;&lt;p&gt;Your code…&lt;/p&gt;&quot;</span>
        {"\n"}
        &nbsp;&nbsp;<span className="tok-str">{"}"}&apos;</span>
      </>
    ),
  },
  Node: {
    title: "send.js — same request in Node",
    copy: `const res = await fetch("https://api.calder.com/v1/emails", {
  method: "POST",
  headers: {
    "Authorization": "Bearer calder_sk_live_…",
    "Idempotency-Key": "welcome-user-4815",
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    from: "app@acme.com",
    to: "ada@example.com",
    subject: "Verify your email",
    html: "<p>Your code is <b>482 915</b></p>",
  }),
});
const { id, status } = await res.json(); // em_9f2k41xq, "queued"`,
    body: (
      <>
        <span className="tok-key">const</span> <span className="tok-path">res</span>{" "}
        <span className="tok-dim">=</span> <span className="tok-key">await</span>{" "}
        <span className="tok-method">fetch</span>(
        <span className="tok-str">&quot;https://api.calder.com/v1/emails&quot;</span>,{" "}
        <span className="tok-punct">{"{"}</span>
        {"\n"}
        &nbsp;&nbsp;<span className="tok-key">method</span>:{" "}
        <span className="tok-str">&quot;POST&quot;</span>,{"\n"}
        &nbsp;&nbsp;<span className="tok-key">headers</span>:{" "}
        <span className="tok-punct">{"{"}</span>
        {"\n"}
        &nbsp;&nbsp;&nbsp;&nbsp;<span className="tok-str">&quot;Authorization&quot;</span>:{" "}
        <span className="tok-str">&quot;Bearer calder_sk_live_…&quot;</span>,{"\n"}
        &nbsp;&nbsp;&nbsp;&nbsp;<span className="tok-str">&quot;Idempotency-Key&quot;</span>:{" "}
        <span className="tok-str">&quot;welcome-user-4815&quot;</span>,{"\n"}
        &nbsp;&nbsp;<span className="tok-punct">{"}"}</span>,{"\n"}
        &nbsp;&nbsp;<span className="tok-key">body</span>:{" "}
        <span className="tok-method">JSON.stringify</span>(<span className="tok-punct">{"{"}</span>{" "}
        <span className="tok-dim">/* from, to, subject, html */</span>{" "}
        <span className="tok-punct">{"}"}</span>),
        {"\n"}
        <span className="tok-punct">{"}"}</span>);
        {"\n"}
        <span className="tok-key">const</span> <span className="tok-punct">{"{ id, status }"}</span>{" "}
        <span className="tok-dim">=</span> <span className="tok-key">await</span>{" "}
        <span className="tok-path">res.json</span>();{" "}
        <span className="tok-dim">{"// em_9f2k41xq, “queued”"}</span>
      </>
    ),
  },
  Python: {
    title: "send.py — same request in Python",
    copy: `import requests

res = requests.post(
    "https://api.calder.com/v1/emails",
    headers={
        "Authorization": "Bearer calder_sk_live_…",
        "Idempotency-Key": "welcome-user-4815",
    },
    json={
        "from": "app@acme.com",
        "to": "ada@example.com",
        "subject": "Verify your email",
        "html": "<p>Your code is <b>482 915</b></p>",
    },
)
print(res.json()["id"])  # em_9f2k41xq`,
    body: (
      <>
        <span className="tok-key">import</span> <span className="tok-path">requests</span>
        {"\n\n"}
        <span className="tok-path">res</span> <span className="tok-dim">=</span>{" "}
        <span className="tok-path">requests.post</span>({"\n"}
        &nbsp;&nbsp;&nbsp;&nbsp;
        <span className="tok-str">&quot;https://api.calder.com/v1/emails&quot;</span>,{"\n"}
        &nbsp;&nbsp;&nbsp;&nbsp;<span className="tok-key">headers</span>
        <span className="tok-dim">=</span>
        <span className="tok-punct">{"{"}</span>{" "}
        <span className="tok-dim">/* Authorization, Idempotency-Key */</span>{" "}
        <span className="tok-punct">{"}"}</span>,{"\n"}
        &nbsp;&nbsp;&nbsp;&nbsp;<span className="tok-key">json</span>
        <span className="tok-dim">=</span>
        <span className="tok-punct">{"{"}</span>{" "}
        <span className="tok-dim">/* from, to, subject, html */</span>{" "}
        <span className="tok-punct">{"}"}</span>,{"\n"}
        );
        {"\n"}
        <span className="tok-method">print</span>(<span className="tok-path">res.json</span>()[
        <span className="tok-str">&quot;id&quot;</span>]){" "}
        <span className="tok-dim"># em_9f2k41xq</span>
      </>
    ),
  },
} as const;

type Lang = keyof typeof SNIPPETS;

/** Tabbed request snippet: cURL, Node, Python — same call, three idioms. */
export function CodeTabs() {
  const [lang, setLang] = React.useState<Lang>("cURL");
  const active = SNIPPETS[lang];

  return (
    <div>
      <div
        className="currency-toggle"
        role="tablist"
        aria-label="Snippet language"
        style={{ marginBottom: "0.8rem" }}
      >
        {(Object.keys(SNIPPETS) as Lang[]).map((l) => (
          <button
            key={l}
            role="tab"
            aria-selected={lang === l}
            aria-pressed={lang === l}
            onClick={() => setLang(l)}
          >
            {l}
          </button>
        ))}
      </div>
      <CodeBlock title={active.title} copyText={active.copy} key={lang}>
        {active.body}
      </CodeBlock>
    </div>
  );
}
