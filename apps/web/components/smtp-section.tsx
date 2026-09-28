import { Reveal } from "./reveal";
import { CodeBlock } from "./code";

/**
 * Two interfaces, one pipeline. API for modern stacks, SMTP for everything
 * that already speaks it, converging into the same queue, worker, events.
 */
export function SmtpSection() {
  return (
    <section className="section" id="smtp" style={{ paddingTop: 0 }}>
      <div className="wrap">
        <Reveal>
          <p className="eyebrow">Two ways in</p>
          <h2 className="h2">
            Use the interface that <em>fits your stack.</em>
          </h2>
          <p className="lede" style={{ marginTop: "1.2rem" }}>
            Building something new? <strong>Use the API.</strong> Already have an application
            sending mail through SMTP? <strong>Keep using SMTP.</strong> Both end up in the same
            Calder pipeline, with the same delivery tracking, events, retries, and observability.
          </p>
        </Reveal>
        <div className="dev-grid">
          <Reveal>
            <div className="pipeline" style={{ marginTop: 0, height: "100%" }}>
              <p className="eyebrow">API</p>
              <p className="caption" style={{ marginBottom: "1.5rem", fontSize: "0.95rem" }}>
                <code>POST /v1/emails &rarr; 202 Accepted</code>
              </p>
              <CodeBlock title="Response" copyText='{"id": "em_9f2k41xq", "status": "queued"}'>
                <span className="tok-punct">{"{"}</span>
                {"\n"}
                &nbsp;&nbsp;<span className="tok-key">&quot;id&quot;</span>:{" "}
                <span className="tok-str">&quot;em_9f2k41xq&quot;</span>,{"\n"}
                &nbsp;&nbsp;<span className="tok-key">&quot;status&quot;</span>:{" "}
                <span className="tok-str">&quot;queued&quot;</span>
                {"\n"}
                <span className="tok-punct">{"}"}</span>
              </CodeBlock>
            </div>
          </Reveal>
          <Reveal delay={120}>
            <div className="pipeline" style={{ marginTop: 0, height: "100%" }}>
              <p className="eyebrow">SMTP</p>
              <p className="caption" style={{ marginBottom: "1.5rem", fontSize: "0.95rem" }}>
                <code>smtp.calder.click:587</code>
              </p>
              <div className="minilog">
                <div className="minilog-row">
                  <span className="status-dot ok" />
                  <span className="addr">
                    <b>STARTTLS</b> &middot; Secure transport
                  </span>
                </div>
                <div className="minilog-row">
                  <span className="status-dot ok" />
                  <span className="addr">
                    <b>Authenticated</b> &middot; Project credentials
                  </span>
                </div>
                <div className="minilog-row">
                  <span className="status-dot ok" />
                  <span className="addr">
                    <b>Same pipeline</b> &middot; Identical tracking
                  </span>
                </div>
              </div>
              <div style={{ marginTop: "2rem" }}>
                <p
                  className="caption"
                  style={{
                    borderLeft: "2px solid var(--border)",
                    paddingLeft: "1.2rem",
                    fontStyle: "italic",
                  }}
                >
                  No mail server to operate.
                  <br />
                  No second system to monitor.
                  <br />
                  No separate set of logs to understand.
                </p>
              </div>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
