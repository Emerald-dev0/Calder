import { Reveal } from "./reveal";
import { CodeBlock } from "./code";

/**
 * Beginner on-ramp: no domain, no SMTP knowledge required. Connect Gmail
 * (OAuth, capped, honest limits) or verify a domain, same API either way,
 * graduation built into the model.
 */
export function BeginnerSection() {
  return (
    <section className="section" id="start-sending" style={{ paddingTop: 0 }}>
      <div className="wrap">
        <Reveal>
          <p className="eyebrow">Built for where you are now</p>
          <h2 className="h2">
            You don&rsquo;t need a perfect setup <em>to get started.</em>
          </h2>
          <p className="lede" style={{ marginTop: "1.2rem" }}>
            Maybe you&rsquo;re building your first Next.js app. Maybe you&rsquo;re testing an idea
            this weekend. Maybe you haven&rsquo;t bought a domain yet. That&rsquo;s fine. Connect a
            Gmail account through Google&rsquo;s authorization, start building, and move to a
            verified sending domain when you&rsquo;re ready. <strong>Same Calder API. Same project. Same logs. Same code.</strong>
          </p>
        </Reveal>
        <div className="dev-grid">
          <Reveal>
            <div className="pipeline" style={{ marginTop: 0, height: "100%" }}>
              <p className="eyebrow">Connect Gmail</p>
              <h3>Start building immediately.</h3>
              <p className="caption" style={{ marginTop: "0.5rem" }}>
                OAuth-based connection with development limits.
              </p>
              <div className="minilog" style={{ marginTop: "1.5rem" }}>
                <div className="minilog-row">
                  <span className="status-dot info" />
                  <span className="addr">Google OAuth 2.0 flow</span>
                </div>
                <div className="minilog-row">
                  <span className="status-dot ok" />
                  <span className="addr">No password required</span>
                </div>
              </div>
            </div>
          </Reveal>
          <Reveal delay={120}>
            <div className="pipeline" style={{ marginTop: 0, height: "100%" }}>
              <p className="eyebrow">Verify a domain</p>
              <h3>Move into production.</h3>
              <p className="caption" style={{ marginTop: "0.5rem" }}>
                Add your DNS records and unlock your sending domain.
              </p>
              <div className="minilog" style={{ marginTop: "1.5rem" }}>
                <div className="minilog-row">
                  <span className="status-dot info" />
                  <span className="addr">SPF · DKIM · DMARC</span>
                </div>
                <div className="minilog-row">
                  <span className="status-dot ok" />
                  <span className="addr">Production limits</span>
                </div>
              </div>
            </div>
          </Reveal>
        </div>
        <Reveal delay={80}>
          <div className="pipeline" style={{ marginTop: "1.5rem" }}>
            <p className="eyebrow">Keep building</p>
            <h3 style={{ fontSize: "1.1rem", fontWeight: 700 }}>No rewrite required.</h3>
            <p className="caption" style={{ marginTop: "0.4rem" }}>
              Change the transport without rebuilding your integration. One click in the dashboard,
              your API keys and code remain exactly the same.
            </p>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
