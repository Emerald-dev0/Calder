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
  [
    "Broadcasts",
    "Often bundled into the sending API",
    "A separate stream: own audiences, own consent, own reputation, same account",
  ],
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
          lede="Same concepts, mechanical changes, no rewrite of your application. Here is the mapping we have done, what carries over untouched, and where Calder deliberately goes a different way."
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
                  Run both providers side by side. New sends go to Calder with a fresh idempotency
                  scheme while the old provider finishes the backlog. Verify your domain here, which
                  means swapping DNS values you already have, then move traffic project by project
                  and cancel when the graph goes quiet.
                </p>
                <ul className="ed-list">
                  <li>Your HTML carries over unchanged, rendered templates included</li>
                  <li>Webhook endpoints are re-registered with a new signing secret</li>
                  <li>Export your suppression list and re-import it through the API</li>
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
                  <span className="tok-str">&quot;https://api.calder.click/v1/emails&quot;</span>,{" "}
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
                  Send us the call you are replacing
                </Link>{" "}
                and we will write the Calder version of it for you. No sales call, no migration fee.
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
