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
            Building something new? <strong>Use the API today.</strong> SMTP is a designed second
            interface, not a running service: there is no host to connect to yet, and no SMTP
            credential to issue. The preview below describes the intended shape.
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
              <p className="eyebrow">SMTP · Coming soon</p>
              <p className="caption" style={{ marginBottom: "1.5rem", fontSize: "0.95rem" }}>
                <code>smtp.calder.click:587</code> — planned, not available
              </p>
              <div className="minilog">
                <div className="minilog-row">
                  <span className="status-dot info" />
                  <span className="addr">
                    <b>STARTTLS</b> &middot; planned
                  </span>
                </div>
                <div className="minilog-row">
                  <span className="status-dot info" />
                  <span className="addr">
                    <b>Authenticated</b> &middot; planned
                  </span>
                </div>
                <div className="minilog-row">
                  <span className="status-dot info" />
                  <span className="addr">
                    <b>Same pipeline</b> &middot; by design
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
                  Planned, not shipped.
                  <br />
                  Use POST /v1/emails today.
                  <br />
                  Do not point production at this host.
                </p>
              </div>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
