import { Reveal } from "./reveal";
import { CodeBlock } from "./code";
import { CodeTabs } from "./code-tabs";

/**
 * Sticky narrative column + scrolling code. Three steps, five minutes,
 * zero yak-shaving: grab a test key, POST, watch the webhook land.
 */
export function Developers() {
  return (
    <section className="section" id="developers" style={{ paddingTop: 0 }}>
      <div className="wrap">
        <Reveal>
          <p className="eyebrow">Developer experience</p>
          <h2 className="h2">
            Your first delivery <em>in about five minutes.</em>
          </h2>
        </Reveal>
        <div className="dev-split">
          <div className="dev-sticky">
            <Reveal>
              <p className="lede">
                No sales call, no credit card, no DNS homework to start. Test keys simulate the
                whole pipeline — queue, provider, events, webhooks — without a single real inbox
                involved.
              </p>
              <ol className="dev-steps">
                <li>
                  <span className="n">01</span>
                  <span>
                    <b>Grab a test key.</b> Prefixed, revocable, hashed at rest. Lives in your{" "}
                    <span className="mono">.env</span> in seconds.
                  </span>
                </li>
                <li>
                  <span className="n">02</span>
                  <span>
                    <b>POST your email.</b> Get a <span className="mono">202</span> back in
                    milliseconds with an id you can track forever.
                  </span>
                </li>
                <li>
                  <span className="n">03</span>
                  <span>
                    <b>Watch the webhook land.</b> Signed, retried, and inspectable — proof of
                    delivery, not vibes.
                  </span>
                </li>
              </ol>
            </Reveal>
          </div>
          <div className="dev-code-stack">
            <Reveal>
              <CodeTabs />
            </Reveal>
            <Reveal delay={100}>
              <CodeBlock title="202 Accepted → webhook event">
                <span className="tok-dim">{"// 202 Accepted"}</span>
                {"\n"}
                <span className="tok-punct">{"{"}</span>
                {"\n"}&nbsp;&nbsp;<span className="tok-key">"id"</span>:{" "}
                <span className="tok-str">"em_9f2k41xq"</span>,{"\n"}&nbsp;&nbsp;
                <span className="tok-key">"status"</span>: <span className="tok-str">"queued"</span>
                {"\n"}
                <span className="tok-punct">{"}"}</span>
                {"\n\n"}
                <span className="tok-dim">{"// …moments later, your webhook receives:"}</span>
                {"\n"}
                <span className="tok-punct">{"{"}</span>
                {"\n"}&nbsp;&nbsp;<span className="tok-key">"event"</span>:{" "}
                <span className="tok-str">"email.delivered"</span>,{"\n"}&nbsp;&nbsp;
                <span className="tok-key">"data"</span>: <span className="tok-punct">{"{"}</span>{" "}
                <span className="tok-key">"email_id"</span>:{" "}
                <span className="tok-str">"em_9f2k41xq"</span>{" "}
                <span className="tok-punct">{"}"}</span>
                {"\n"}
                <span className="tok-punct">{"}"}</span>
              </CodeBlock>
            </Reveal>
            <Reveal delay={60}>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.6rem" }} className="mono">
                <span className="keyline">
                  Errors — {"{ error: { code, message, request_id } }"}
                </span>
                <span className="keyline">Keys — calder_sk_test_… never leaves the sandbox</span>
              </div>
            </Reveal>
          </div>
        </div>
      </div>
    </section>
  );
}
