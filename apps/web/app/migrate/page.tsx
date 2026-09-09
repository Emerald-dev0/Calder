import type { Metadata } from "next";
import Link from "next/link";
import { Navigation } from "../../components/navigation";
import { FinalCta, Footer } from "../../components/closing";
import { PageHero } from "../../components/page-hero";
import { CodeBlock } from "../../components/code";
import { Reveal } from "../../components/reveal";
import { pageMeta } from "../../lib/seo";

export const metadata: Metadata = pageMeta({
 title: "Switch to Calder",
 description:
 "Move transactional sending to Calder in an afternoon. Same concepts, mechanical steps, zero downtime.",
 path: "/migrate",
});

const DIFFERENCES = [
 ["Sends", "provider.emails.send()", "POST /v1/emails, same fields, different envelope"],
 ["Response", "200 + { id }", "202 + { id, status }, async by design, not by accident"],
 ["Retries", "Your code, your problem", "Idempotency-Key, retry freely, send once"],
 ["Webhooks", "Fire-and-forget events", "Same events, plus visible retries and replay"],
 ["Broadcasts", "Often bundled in", "Not built, on purpose, transactional only"],
 ["Pricing", "USD, overages", "NGN + USD, hard limits, no surprise bills"],
] as const;

export default function MigratePage() {
 return (
 <>
 <Navigation />
 <main>
 <PageHero
 eyebrow="Switch"
 title={
 <>
 Move over <em>in an afternoon.</em>
 </>
 }
 lede="Same concepts, mechanical changes. Below is the honest mapping, what transfers directly, what's better here, and the one thing we deliberately don't do."
 />
 <section className="section" style={{ paddingTop: 0 }}>
 <div className="wrap">
 <Reveal>
 <table className="docs-table">
 <thead>
 <tr>
 <th>Concern</th>
 <th>Typical provider</th>
 <th>Calder</th>
 </tr>
 </thead>
 <tbody>
 {DIFFERENCES.map(([c, r, a]) => (
 <tr key={c}>
 <td>
 <b style={{ color: "var(--ink)" }}>{c}</b>
 </td>
 <td className="mono">{r}</td>
 <td>{a}</td>
 </tr>
 ))}
 </tbody>
 </table>
 </Reveal>
 <div className="ed-row">
 <Reveal className="ed-copy">
 <div className="ed-index">The move</div>
 <h3>Three steps, zero downtime</h3>
 <p>
 Run both providers in parallel: new sends go to Calder with a fresh idempotency
 scheme while history drains from the old one. Verify your domain here (same DNS
 records, new values), flip traffic project by project, then cancel.
 </p>
 <ul className="ed-list">
 <li>Keep your HTML, any rendered template sends as-is</li>
 <li>Re-register webhook endpoints and secrets</li>
 <li>Export suppression lists and re-import manually</li>
 </ul>
 </Reveal>
 <Reveal delay={120}>
 <CodeBlock title="the shape of the change">
 <span className="tok-dim">{"// before"}</span>
 {"\n"}
 <span className="tok-key">await</span>{" "}
 <span className="tok-path">provider.emails.send</span>(
 <span className="tok-punct">{"{"}</span> <span className="tok-dim">/* … */</span>{" "}
 <span className="tok-punct">{"}"}</span>);
 {"\n\n"}
 <span className="tok-dim">{"// after"}</span>
 {"\n"}
 <span className="tok-key">await</span> <span className="tok-method">fetch</span>(
 <span className="tok-str">&quot;https://api.calder.click/v1/emails&quot;</span>, {" "}
 <span className="tok-punct">{"{"}</span>
 {"\n"}
 &nbsp;&nbsp;<span className="tok-key">method</span>:{" "}
 <span className="tok-str">&quot;POST&quot;</span>, {"\n"}
 &nbsp;&nbsp;<span className="tok-key">headers</span>:{" "}
 <span className="tok-punct">{"{"}</span>{" "}
 <span className="tok-dim">/* key + Idempotency-Key */</span>{" "}
 <span className="tok-punct">{"}"}</span>, {"\n"}
 &nbsp;&nbsp;<span className="tok-key">body</span>:{" "}
 <span className="tok-method">JSON.stringify</span>(
 <span className="tok-punct">{"{"}</span>{" "}
 <span className="tok-dim">/* same fields */</span>{" "}
 <span className="tok-punct">{"}"}</span>),
 {"\n"}
 <span className="tok-punct">{"}"}</span>);
 </CodeBlock>
 </Reveal>
 </div>
 <Reveal>
 <p className="caption" style={{ textAlign: "center" }}>
 Stuck?{" "}
 <Link href="/support" style={{ color: "var(--accent)" }}>
 We help with migrations personally
 </Link>{" "}
, send shape included, no sales call required.
 </p>
 </Reveal>
 </div>
 </section>
 <FinalCta />
 </main>
 <Footer />
 </>
 );
}
