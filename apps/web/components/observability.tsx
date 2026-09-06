import { Reveal } from "./reveal";

/**
 * Observability + domain identity. Lifecycle states are the real ones
 * from ARCHITECTURE.md §8; verification copy respects ADR-005 honesty.
 */
export function Observability() {
  return (
    <section className="section" id="observability" style={{ paddingTop: 0 }}>
      <div className="wrap">
        <Reveal>
          <p className="eyebrow">Observability</p>
          <h2 className="h2">
            &ldquo;I never got the email.&rdquo; <em>Now you have an answer.</em>
          </h2>
          <p className="lede" style={{ marginTop: "1.2rem" }}>
            Every response carries a request ID. Every email gets a timeline from creation to open.
            So the next time support pings you, you&rsquo;re not guessing — you&rsquo;re reading:
            queued at 12ms, accepted by the provider, delivered in a second, opened four minutes
            later.
          </p>
        </Reveal>
        <Reveal delay={120}>
          <div className="pipeline" style={{ marginTop: "2.5rem" }}>
            <div
              className="mono"
              style={{ fontSize: "0.78rem", color: "var(--muted)", marginBottom: "1rem" }}
            >
              em_9f2k41xq · req_x7k2… · project acme/production
            </div>
            <div className="minilog">
              {[
                ["created", "ok", "validated · suppression checked · persisted", "t+0ms"],
                ["queued", "info", "job accepted · worker picked up", "t+12ms"],
                ["sent", "info", "provider accepted · MessageId ses_84…", "t+340ms"],
                ["delivered", "ok", "inbox confirmed", "t+1.02s"],
                ["opened", "ok", "first open recorded", "t+4m"],
              ].map(([state, tone, detail, time]) => (
                <div className="minilog-row" key={state}>
                  <span className={`status-dot ${tone}`} />
                  <span className="addr">
                    <b>{state}</b> — {detail}
                  </span>
                  <span className="time">{time}</span>
                </div>
              ))}
            </div>
          </div>
        </Reveal>

        <div className="ed-row" style={{ marginTop: "1rem" }}>
          <Reveal className="ed-copy">
            <div className="ed-index">04</div>
            <h3>Your domain, verified. Your reputation, visible.</h3>
            <p>
              Sending from <span className="mono">you@yourproduct.com</span> beats{" "}
              <span className="mono">you@someone-elses-service.com</span> — for deliverability and
              for trust. Verify with DNS, watch bounce and complaint rates per domain, and if you
              deploy on a hosted platform, we&rsquo;ll verify the project and map sending honestly
              instead of pretending DNS works differently than it does.
            </p>
            <ul className="ed-list">
              <li>DNS-based verification with guided records</li>
              <li>Per-domain reputation, bounce and complaint rates</li>
              <li>Test keys simulate the whole flow without real delivery</li>
            </ul>
          </Reveal>
          <Reveal delay={120} className="ed-visual">
            <div className="keyline">TXT _avenor.acme.com → "avenor_verify_9f2k…"</div>
            <dl className="kv">
              <dt>acme.com</dt>
              <dd>
                <span className="tag ok">verified</span> · bounce 0.3% · complaint 0.01%
              </dd>
              <dt>staging.acme.com</dt>
              <dd>
                <span className="tag ok">verified</span> · test traffic only
              </dd>
              <dt>new.acme.com</dt>
              <dd>
                <span className="tag warn">pending</span> · awaiting DNS propagation
              </dd>
            </dl>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
