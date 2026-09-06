import type { Metadata } from "next";
import { Navigation } from "../../components/navigation";
import { FinalCta, Footer } from "../../components/closing";
import { PageHero } from "../../components/page-hero";
import { CodeBlock } from "../../components/code";
import { Reveal } from "../../components/reveal";

export const metadata: Metadata = {
  title: "Webhooks — Avenor",
  description:
    "Signed, retried, inspectable webhook deliveries for every email event. Attempt history, replay, and verification.",
};

const EVENTS = [
  ["email.queued", "Your send was accepted and persisted."],
  ["email.sent", "A provider accepted the message for delivery."],
  ["email.delivered", "The recipient's server confirmed receipt."],
  ["email.bounced", "Delivery failed permanently — reason included."],
  ["email.complained", "Recipient marked it spam — suppress automatically."],
  ["email.failed", "Exhausted retries or permanent provider rejection."],
  ["email.opened", "The message was opened (tracking pixel)."],
  ["email.clicked", "A link in the message was clicked."],
] as const;

export default function WebhooksPage() {
  return (
    <>
      <Navigation />
      <main>
        <PageHero
          eyebrow="Webhooks"
          title={
            <>
              Webhooks that <em>show their work.</em>
            </>
          }
          lede="Every lifecycle event, delivered to your server signed and retried — with attempt history you can inspect and replay instead of a black box that fires once into the void."
        />
        <section className="section" style={{ paddingTop: 0 }}>
          <div className="wrap">
            <Reveal>
              <p className="eyebrow">Event catalog</p>
              <h2 className="h2">
                Eight events. <em>Zero mysteries.</em>
              </h2>
            </Reveal>
            <Reveal delay={100}>
              <div className="pipeline" style={{ marginTop: "2rem" }}>
                <div className="minilog">
                  {EVENTS.map(([name, desc]) => (
                    <div className="minilog-row" key={name}>
                      <span className="status-dot info" />
                      <span className="addr">
                        <b className="mono">{name}</b> — {desc}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </Reveal>
            <div className="ed-row">
              <Reveal className="ed-copy">
                <div className="ed-index">Trust, then verify</div>
                <h3>Signed, timestamped, replay-safe</h3>
                <p>
                  Every delivery carries an HMAC signature and an idempotent event ID. Verify the
                  signature, dedupe on the ID, and process each event exactly once — even when we
                  retry it three times to get it to you.
                </p>
                <ul className="ed-list">
                  <li>Failures retry with backoff, visibly, in your dashboard</li>
                  <li>Replay any delivery manually after an outage</li>
                  <li>Per-endpoint history: what we sent, what you answered</li>
                </ul>
              </Reveal>
              <Reveal delay={120}>
                <CodeBlock title="verify.js — trust, then verify">
                  <span className="tok-key">import</span> <span className="tok-path">crypto</span>{" "}
                  <span className="tok-key">from</span>{" "}
                  <span className="tok-str">&quot;node:crypto&quot;</span>;{"\n\n"}
                  <span className="tok-key">function</span>{" "}
                  <span className="tok-method">verify</span>(
                  <span className="tok-path">rawBody</span>,{" "}
                  <span className="tok-path">signature</span>,{" "}
                  <span className="tok-path">secret</span>) <span className="tok-punct">{"{"}</span>
                  {"\n"}
                  &nbsp;&nbsp;<span className="tok-key">const</span>{" "}
                  <span className="tok-path">digest</span> <span className="tok-dim">=</span>{" "}
                  <span className="tok-path">crypto</span>.
                  <span className="tok-method">createHmac</span>(
                  <span className="tok-str">&quot;sha256&quot;</span>,{" "}
                  <span className="tok-path">secret</span>){"\n"}
                  &nbsp;&nbsp;&nbsp;&nbsp;.<span className="tok-method">update</span>(
                  <span className="tok-path">rawBody</span>) .
                  <span className="tok-method">digest</span>(
                  <span className="tok-str">&quot;hex&quot;</span>);
                  {"\n"}
                  &nbsp;&nbsp;<span className="tok-key">return</span>{" "}
                  <span className="tok-path">crypto</span>.
                  <span className="tok-method">timingSafeEqual</span>({"\n"}
                  &nbsp;&nbsp;&nbsp;&nbsp;<span className="tok-method">Buffer.from</span>(
                  <span className="tok-path">digest</span>),
                  {"\n"}
                  &nbsp;&nbsp;&nbsp;&nbsp;<span className="tok-method">Buffer.from</span>(
                  <span className="tok-path">signature</span>),
                  {"\n"}
                  &nbsp;&nbsp;);
                  {"\n"}
                  <span className="tok-punct">{"}"}</span>
                </CodeBlock>
              </Reveal>
            </div>
          </div>
        </section>
        <FinalCta />
      </main>
      <Footer />
    </>
  );
}
