import type { Metadata } from "next";
import { Navigation } from "../../components/navigation";
import { FinalCta, Footer } from "../../components/closing";
import { PageHero } from "../../components/page-hero";
import { CodeBlock } from "../../components/code";
import { Reveal } from "../../components/reveal";

export const metadata: Metadata = {
  title: "Webhooks, Calder",
  description:
    "Signed, retried, inspectable webhook deliveries for every email event. Attempt history, replay, and verification.",
};

/**
 * Event catalog, split by what is actually emitted today. Provider-side
 * signals (delivered/bounce/complaint) arrive when SES event notifications are
 * wired in; marking them "live" before that would be a claim a developer can
 * disprove in five minutes with one webhook endpoint.
 */
const LIVE_EVENTS = [
  ["email.sent", "A provider accepted the message for delivery."],
  ["email.failed", "Permanent provider rejection, retries exhausted, or invalid input."],
] as const;

const DEV_EVENTS = [
  ["email.delivered", "The recipient's server confirmed receipt."],
  ["email.bounced", "Delivery failed permanently, reason included."],
  ["email.complained", "Recipient marked it spam, suppressed automatically."],
  ["email.opened", "The message was opened."],
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
          lede="Every lifecycle event, delivered to your server signed and retried, with attempt history you can inspect and replay instead of a black box that fires once into the void."
        />
        <section className="section" style={{ paddingTop: 0 }}>
          <div className="wrap">
            <Reveal>
              <p className="eyebrow">Event catalog</p>
              <h2 className="h2">
                Every lifecycle event, <em>and exactly which ones fire today.</em>
              </h2>
              <p className="lede" style={{ marginTop: "1.2rem" }}>
                Calder records the full lifecycle. Two of these are wired to webhooks right now, and
                the rest are marked where they stand, because an event table that oversells itself
                is worse than a short one.
              </p>
            </Reveal>
            <Reveal delay={100}>
              <div className="pipeline" style={{ marginTop: "2rem" }}>
                <div className="minilog">
                  {LIVE_EVENTS.map(([name, desc]) => (
                    <div className="minilog-row" key={name}>
                      <span className="status-dot ok" />
                      <span className="addr">
                        <b className="mono">{name}</b>, {desc}
                      </span>
                      <span className="tag ok">live</span>
                    </div>
                  ))}
                  {DEV_EVENTS.map(([name, desc]) => (
                    <div className="minilog-row" key={name}>
                      <span className="status-dot info" />
                      <span className="addr">
                        <b className="mono">{name}</b>, {desc}
                      </span>
                      <span className="tag info">in development</span>
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
                  signature, dedupe on the ID, and process each event exactly once, even when we
                  retry it three times to get it to you.
                </p>
                <ul className="ed-list">
                  <li>Failures retry with backoff, visibly, in your dashboard</li>
                  <li>Replay any delivery manually after an outage</li>
                  <li>Per-endpoint history: what we sent, what you answered</li>
                </ul>
              </Reveal>
              <Reveal delay={120}>
                <CodeBlock title="verify.js, trust, then verify">
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
