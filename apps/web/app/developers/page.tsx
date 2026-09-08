import type { Metadata } from "next";
import { Navigation } from "../../components/navigation";
import { FinalCta, Footer } from "../../components/closing";
import { PageHero } from "../../components/page-hero";
import { CodeTabs } from "../../components/code-tabs";
import { CodeBlock } from "../../components/code";
import { Reveal } from "../../components/reveal";

export const metadata: Metadata = {
  title: "Developers — Calder",
  description:
    "The Calder developer platform: versioned REST API, SDKs, idempotency, test keys, predictable errors, and rate limits.",
};

const LIMITS = [
  ["Sending", "100 / min", "Per key, project, and organization"],
  ["Verification", "10 / min", "Domain checks are expensive — for everyone"],
  ["Auth", "20 / min", "Brute force gets bored and leaves"],
  ["OTP", "5 / min", "Codes are precious; treat them that way"],
  ["Dashboard", "120 / min", "Click around freely"],
] as const;

export default function DevelopersPage() {
  return (
    <>
      <Navigation />
      <main>
        <PageHero
          eyebrow="Developers"
          title={
            <>
              An API that behaves <em>like you&rsquo;d design it.</em>
            </>
          }
          lede="Versioned from day one, predictable errors with request IDs, idempotency where duplication hurts, and test keys that simulate everything. Boring in all the ways infrastructure should be boring."
        />
        <section className="section" style={{ paddingTop: 0 }}>
          <div className="wrap">
            <Reveal>
              <CodeTabs />
            </Reveal>
            <div className="ed-row">
              <Reveal className="ed-copy">
                <div className="ed-index">Contracts</div>
                <h3>Errors you can program against</h3>
                <p>
                  Every failure returns the same shape — a machine-readable code, a human message,
                  and the request ID to quote when asking for help. No HTML error pages, no mystery
                  500s, no digging through headers.
                </p>
              </Reveal>
              <Reveal delay={120}>
                <CodeBlock title="every error, every time">
                  <span className="tok-punct">{"{"}</span>
                  {"\n"}
                  &nbsp;&nbsp;<span className="tok-key">&quot;error&quot;</span>:{" "}
                  <span className="tok-punct">{"{"}</span>
                  {"\n"}
                  &nbsp;&nbsp;&nbsp;&nbsp;<span className="tok-key">&quot;code&quot;</span>:{" "}
                  <span className="tok-str">&quot;domain_not_verified&quot;</span>,{"\n"}
                  &nbsp;&nbsp;&nbsp;&nbsp;<span className="tok-key">&quot;message&quot;</span>:{" "}
                  <span className="tok-str">
                    &quot;The sending domain has not been verified.&quot;
                  </span>
                  ,{"\n"}
                  &nbsp;&nbsp;&nbsp;&nbsp;<span className="tok-key">
                    &quot;request_id&quot;
                  </span>: <span className="tok-str">&quot;req_9f2k41xq…&quot;</span>
                  {"\n"}
                  &nbsp;&nbsp;<span className="tok-punct">{"}"}</span>
                  {"\n"}
                  <span className="tok-punct">{"}"}</span>
                </CodeBlock>
              </Reveal>
            </div>
            <Reveal>
              <p className="eyebrow">Rate limits</p>
              <h2 className="h2">
                Generous where it matters, <em>strict where it counts.</em>
              </h2>
            </Reveal>
            <Reveal delay={100}>
              <div className="pipeline" style={{ marginTop: "2rem" }}>
                <div className="minilog">
                  {LIMITS.map(([name, limit, note]) => (
                    <div className="minilog-row" key={name}>
                      <span className="status-dot info" />
                      <span className="addr">
                        <b>{name}</b> — {note}
                      </span>
                      <span className="tag info mono">{limit}</span>
                    </div>
                  ))}
                </div>
                <p className="caption" style={{ marginTop: "1rem" }}>
                  Every 429 carries limit, remaining, reset, and a Retry-After. No guessing games.
                </p>
                <div style={{ marginTop: "2rem", display: "flex", justifyContent: "center" }}>
                  <a className="btn btn-primary" href="/waitlist">
                    Join the waitlist{" "}
                    <span className="arrow" aria-hidden="true">
                      →
                    </span>
                  </a>
                </div>
              </div>
            </Reveal>
          </div>
        </section>
        <FinalCta />
      </main>
      <Footer />
    </>
  );
}
