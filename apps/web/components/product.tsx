import { Reveal } from "./reveal";
import { TemplateScene, DomainScene, MeterScene } from "./product-scenes";

/**
 * The actual offering: what life inside Calder looks like day to day.
 * Templates are post-MVP per the PRD, so the row says "in development"
 * rather than pretending to ship today.
 */
export function ProductTour() {
  return (
    <section className="section" id="product">
      <div className="wrap">
        <Reveal>
          <p className="eyebrow">The infrastructure underneath</p>
          <h2 className="h2">
            Everything connected. <em>Nothing hidden.</em>
          </h2>
          <p className="lede" style={{ marginTop: "1.2rem" }}>
            Calder brings the pieces together so you don&rsquo;t have to build and maintain them
            yourself.
          </p>
        </Reveal>

        <div className="dev-grid" style={{ marginTop: "4rem" }}>
          <Reveal className="price-card">
            <p className="eyebrow">API</p>
            <h3 style={{ fontSize: "1.2rem", fontWeight: 700, marginBottom: "0.5rem" }}>
              Fast responses.
            </h3>
            <p className="caption">
              Accept requests in milliseconds and move delivery work off the request path.
            </p>
          </Reveal>

          <Reveal delay={50} className="price-card">
            <p className="eyebrow">Queue</p>
            <h3 style={{ fontSize: "1.2rem", fontWeight: 700, marginBottom: "0.5rem" }}>
              Reliable processing.
            </h3>
            <p className="caption">
              Redis-backed queues, retries, backoff, and dead-letter handling.
            </p>
          </Reveal>

          <Reveal delay={100} className="price-card">
            <p className="eyebrow">Store</p>
            <h3 style={{ fontSize: "1.2rem", fontWeight: 700, marginBottom: "0.5rem" }}>
              A source of truth.
            </h3>
            <p className="caption">
              PostgreSQL records your messages, events, usage, and delivery history.
            </p>
          </Reveal>

          <Reveal delay={150} className="price-card">
            <p className="eyebrow">Delivery</p>
            <h3 style={{ fontSize: "1.2rem", fontWeight: 700, marginBottom: "0.5rem" }}>
              Provider infrastructure.
            </h3>
            <p className="caption">
              Provider abstraction gives Calder room to route, retry, and evolve without changing
              your application.
            </p>
          </Reveal>

          <Reveal delay={200} className="price-card">
            <p className="eyebrow">Events</p>
            <h3 style={{ fontSize: "1.2rem", fontWeight: 700, marginBottom: "0.5rem" }}>
              A complete lifecycle.
            </h3>
            <p className="caption">Signed webhooks keep your application informed.</p>
          </Reveal>

          <Reveal delay={250} className="price-card">
            <p className="eyebrow">Billing</p>
            <h3 style={{ fontSize: "1.2rem", fontWeight: 700, marginBottom: "0.5rem" }}>
              Usage you can understand.
            </h3>
            <p className="caption">
              Your usage, invoices, and plan limits come from the same underlying records.
            </p>
          </Reveal>
        </div>

        <div style={{ marginTop: "6rem" }}>
          {/* Projects */}
          <div className="ed-row">
            <Reveal className="ed-copy">
              <div className="ed-index">Projects &amp; environments</div>
              <h3>One Calder account. Every application.</h3>
              <p>
                Keep your projects separate without creating a separate account for every thing you
                build. <strong>Production. Staging. Development. That side project you swear
                you&rsquo;re going to finish.</strong>
              </p>
              <p className="caption">
                Each project gets its own keys, logs, environments, configuration, and usage.
              </p>
            </Reveal>
            <Reveal delay={120} className="ed-visual">
              <div className="minilog">
                <div className="minilog-row">
                  <span className="status-dot ok" />
                  <span className="addr">acme / production</span>
                  <span className="tag ok">live</span>
                </div>
                <div className="minilog-row">
                  <span className="status-dot info" />
                  <span className="addr">acme / staging</span>
                  <span className="tag info">test</span>
                </div>
              </div>
            </Reveal>
          </div>

          {/* Domains */}
          <div className="ed-row flip">
            <Reveal className="ed-copy">
              <div className="ed-index">Sending setup</div>
              <h3>Put your name on the message.</h3>
              <p>
                Connect your domain. Add the required DNS records. Verify it once. Then Calder
                handles the infrastructure underneath.
              </p>
              <p className="caption" style={{ fontWeight: 600 }}>
                SPF · DKIM · DMARC · Domain verification
              </p>
            </Reveal>
            <Reveal delay={120} className="ed-visual">
              <DomainScene />
            </Reveal>
          </div>

          {/* Templates */}
          <div className="ed-row">
            <Reveal className="ed-copy">
              <div className="ed-index">Templates</div>
              <h3>Stop deploying just to change an email.</h3>
              <p>
                Build reusable templates with variables, previews, versions, and publishing
                controls. Your developers shouldn&rsquo;t need to touch application code every time
                someone wants to change: <b>&ldquo;Welcome to the team.&rdquo;</b>
              </p>
            </Reveal>
            <Reveal delay={120} className="ed-visual">
              <TemplateScene />
            </Reveal>
          </div>

          {/* Observability */}
          <div className="ed-row flip" id="observability">
            <Reveal className="ed-copy">
              <div className="ed-index">Built-in observability</div>
              <h3>Your messages leave a trail.</h3>
              <p>
                Every send creates a record. Every transition creates an event. Every failure has
                context. Every delivery has a history.
              </p>
              <p className="caption" style={{ fontWeight: 600 }}>
                Search by: Email ID · Request ID · Recipient · Project · Status · Date
              </p>
              <p style={{ marginTop: "1rem" }}>
                And when something goes wrong, follow the trail instead of guessing.
              </p>
            </Reveal>
            <Reveal delay={120} className="ed-visual">
              <div className="minilog">
                <div className="minilog-row">
                  <span className="status-dot ok" />
                  <span className="addr">Search: request_id=req_x7k2&hellip;</span>
                </div>
                <div className="minilog-row" style={{ opacity: 0.8 }}>
                  <span className="status-dot ok" />
                  <span className="addr">em_9f2k41xq &middot; Delivered</span>
                </div>
              </div>
            </Reveal>
          </div>
        </div>
      </div>
    </section>
  );
}
