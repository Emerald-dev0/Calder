import { Reveal } from "./reveal";
import { CodeBlock } from "./code";

/**
 * Beginner on-ramp: no domain, no SMTP knowledge required. Connect Gmail
 * (OAuth, capped, honest limits) or verify a domain, same API either way,
 * graduation built into the model.
 */
export function BeginnerSection() {
 return (
 <section className="section" id="start-sending" style={{ paddingTop: 0 }}>
 <div className="wrap">
 <Reveal>
 <p className="eyebrow">Start without a domain</p>
 <h2 className="h2">
 Sixteen and learning Next.js? <em>Send email today.</em>
 </h2>
 <p className="lede" style={{ marginTop: "1.2rem" }}>
 No domain to buy, no DNS to decipher, no SMTP server to babysit. Connect the Gmail
 account you already have, through Google&rsquo;s own authorization, never your password
, and send through the same API, logs, and events as everyone else. When the project
 grows up, verify a domain and graduate. Nothing rewrites.
 </p>
 </Reveal>
 <div className="dev-grid">
 <Reveal>
 <CodeBlock
 title="gmail quickstart, same Calder API"
 copyText={`curl https://api.calder.click/v1/emails -H "Authorization: Bearer calder_sk_test_…" -d '{"from":"myproject@gmail.com", "to":"customer@example.com", "subject":"Welcome!", "html":"<h1>Welcome!</h1>"}'`}
 >
 <span className="tok-dim">$</span> <span className="tok-key">curl</span>{" "}
 <span className="tok-path">https://api.calder.click/v1/emails</span>{" "}
 <span className="tok-dim">\</span>
 {"\n"}
 &nbsp;&nbsp;<span className="tok-dim">-H</span>{" "}
 <span className="tok-str">&quot;Authorization: Bearer calder_sk_test_…&quot;</span>{" "}
 <span className="tok-dim">\</span>
 {"\n"}
 &nbsp;&nbsp;<span className="tok-dim">-d</span>{" "}
 <span className="tok-str">
 &apos;{"{"}
 &quot;from&quot;:&quot;myproject@gmail.com&quot;, &quot;to&quot;:&quot;customer@example.com&quot;, &quot;subject&quot;:&quot;Welcome!&quot;, &quot;html&quot;:&quot;&lt;h1&gt;Welcome!&lt;/h1&gt;&quot;
 {"}"}&apos;
 </span>
 {"\n\n"}
 <span className="tok-dim">
 {"// SDKs (npm install calder) land with v1, the API above is stable now."}
 </span>
 </CodeBlock>
 </Reveal>
 <Reveal delay={120}>
 <div className="pipeline" style={{ marginTop: 0, height: "100%" }}>
 <p className="eyebrow">How you start</p>
 <div className="minilog">
 <div className="minilog-row">
 <span className="status-dot info" />
 <span className="addr">
 <b>Connect Gmail</b>, OAuth, two clicks, capped for development
 </span>
 <span className="tag info">no domain</span>
 </div>
 <div className="minilog-row">
 <span className="status-dot info" />
 <span className="addr">
 <b>Or verify a domain</b>, DNS records, full production capacity
 </span>
 <span className="tag info">production</span>
 </div>
 <div className="minilog-row">
 <span className="status-dot ok" />
 <span className="addr">
 <b>Graduate anytime</b>, same key, same code, new transport
 </span>
 <span className="tag ok">no rewrite</span>
 </div>
 </div>
 <p className="caption" style={{ marginTop: "1rem" }}>
 Gmail sending is capped and rate-limited on purpose, it&rsquo;s the on-ramp, not
 bulk infrastructure. Limits are always visible before you hit them. Full
 walkthrough:{" "}
 <a href="/docs/gmail-quickstart" style={{ color: "var(--accent)" }}>
 Gmail Quickstart →
 </a>
 </p>
 </div>
 </Reveal>
 </div>
 <Reveal delay={80}>
 <div className="pipeline-return" style={{ marginTop: "2rem" }}>
 <span>No domain →</span>
 <span className="event-pill">Connect Gmail</span>
 <span>→ build → grow →</span>
 <span className="event-pill">Verify domain</span>
 <span>→ production infrastructure. Same key throughout.</span>
 </div>
 </Reveal>
 </div>
 </section>
 );
}
