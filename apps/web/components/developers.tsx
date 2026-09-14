import { Reveal } from "./reveal";
import { CodeBlock } from "./code";
import { CodeTabs } from "./code-tabs";

/**
 * Sticky narrative column + scrolling code. Three steps, five minutes,
 * zero yak-shaving: grab a test key, POST, watch the webhook land.
 */
export function Developers() {
  return (
    <section className="section" id="developers">
      <div className="wrap">
        <Reveal>
          <p className="eyebrow">Developer experience</p>
          <h2 className="h2">
            From zero to your first <em>delivery in minutes.</em>
          </h2>
          <p className="lede" style={{ marginTop: "1.2rem" }}>
            No sales call. No credit card. No infrastructure homework. Create an account, grab a
            test key, make a request, and see the entire lifecycle inside Calder.
          </p>
        </Reveal>

        <div className="dev-split">
          <Reveal className="dev-sticky">
            <div className="dev-copy">
              <ul className="dev-steps">
                <li>
                  <span className="n">01</span>
                  <div>
                    <b>Create a project.</b>
                    <p>Your project gets its own keys, environments, logs, and configuration.</p>
                  </div>
                </li>
                <li>
                  <span className="n">02</span>
                  <div>
                    <b>Send an email.</b>
                    <p>One API request. A predictable response.</p>
                  </div>
                </li>
                <li>
                  <span className="n">03</span>
                  <div>
                    <b>Watch it move.</b>
                    <p>See the message travel through Calder in real time.</p>
                  </div>
                </li>
                <li>
                  <span className="n">04</span>
                  <div>
                    <b>Listen for events.</b>
                    <p>Signed webhooks tell your application what happened.</p>
                  </div>
                </li>
                <li>
                  <span className="n">05</span>
                  <div>
                    <b>Investigate when you need to.</b>
                    <p>Every message has a searchable history.</p>
                  </div>
                </li>
              </ul>
            </div>
          </Reveal>
          <Reveal delay={120} className="dev-code-stack">
            <CodeBlock
              title="Step 2: Send an email"
              copyText='curl https://api.calder.click/v1/emails -H "Authorization: Bearer calder_sk_test_…" -d "{\"from\": \"hello@calder.click\", \"to\": \"you@example.com\", \"subject\": \"Hello from Calder\", \"text\": \"This is a test.\"}"'
            >
              <span className="tok-dim">$</span> <span className="tok-key">curl</span>{" "}
              <span className="tok-path">https://api.calder.click/v1/emails</span>{" "}
              <span className="tok-dim">\</span>
              {"\n"}
              &nbsp;&nbsp;<span className="tok-dim">-H</span>{" "}
              <span className="tok-str">&quot;Authorization: Bearer calder_sk_test_&hellip;&quot;</span>{" "}
              <span className="tok-dim">\</span>
              {"\n"}
              &nbsp;&nbsp;<span className="tok-dim">-d</span>{" "}
              <span className="tok-str">
                &apos;{"{"} &quot;from&quot;: &quot;hello@calder.click&quot;, &hellip; {"}"}&apos;
              </span>
            </CodeBlock>
            <div className="pipeline" style={{ marginTop: 0 }}>
              <p className="eyebrow">Step 3: Watch it move</p>
              <div className="minilog">
                <div className="minilog-row">
                  <span className="status-dot ok" />
                  <span className="addr">email.queued</span>
                  <span className="time">12ms</span>
                </div>
                <div className="minilog-row">
                  <span className="status-dot info" />
                  <span className="addr">email.sending</span>
                  <span className="time">180ms</span>
                </div>
                <div className="minilog-row">
                  <span className="status-dot ok" />
                  <span className="addr">email.sent</span>
                  <span className="time">340ms</span>
                </div>
              </div>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
