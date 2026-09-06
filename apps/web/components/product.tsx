import { Reveal } from "./reveal";
import { TemplateScene, DomainScene, MeterScene } from "./product-scenes";

/**
 * The actual offering: what life inside Avenor looks like day to day.
 * Templates is post-MVP per the PRD, so it wears an honest "Soon" tag
 * instead of pretending to ship today.
 */
export function ProductTour() {
  return (
    <section className="section" id="product" style={{ paddingTop: 0 }}>
      <div className="wrap">
        <Reveal>
          <p className="eyebrow">The product</p>
          <h2 className="h2">
            Everything in the box, <em>nothing you have to glue together.</em>
          </h2>
          <p className="lede" style={{ marginTop: "1.2rem" }}>
            Providers, DNS, queues, retries, webhooks, suppression, billing — the fragmented mess
            the PRD people complain about, already assembled into one dashboard and one API.
          </p>
        </Reveal>

        <div style={{ marginTop: "2rem" }}>
          {/* Projects */}
          <div className="ed-row">
            <span className="ghost-num" data-parallax="0.08" aria-hidden="true">
              ✦
            </span>
            <Reveal className="ed-copy">
              <div className="ed-index">Projects &amp; environments</div>
              <h3>One account, every app and stage</h3>
              <p>
                Organize sending by organization, then split into projects — production, staging,
                that side-project. Test keys behave exactly like live ones except nothing ever
                leaves the building.
              </p>
              <ul className="ed-list">
                <li>Separate test and live API keys per project</li>
                <li>Per-project logs, events, and rate limits</li>
                <li>Revoke and rotate keys without touching code</li>
              </ul>
            </Reveal>
            <Reveal delay={120} className="ed-visual">
              <div className="minilog">
                <div className="minilog-row">
                  <span className="status-dot ok" />
                  <span className="addr">acme / production</span>
                  <span className="tag ok">live</span>
                  <span className="time">42k/mo</span>
                </div>
                <div className="minilog-row">
                  <span className="status-dot info" />
                  <span className="addr">acme / staging</span>
                  <span className="tag info">test</span>
                  <span className="time">1.2k/mo</span>
                </div>
                <div className="minilog-row">
                  <span className="status-dot ok" />
                  <span className="addr">side-project</span>
                  <span className="tag ok">live</span>
                  <span className="time">300/mo</span>
                </div>
              </div>
              <dl className="kv">
                <dt>keys</dt>
                <dd>avenor_sk_test_… · avenor_sk_live_… — hashed, revocable</dd>
                <dt>isolation</dt>
                <dd>every query scoped to its project, always</dd>
              </dl>
            </Reveal>
          </div>

          {/* Domains */}
          <div className="ed-row flip">
            <span className="ghost-num" data-parallax="0.08" aria-hidden="true">
              ✦
            </span>
            <Reveal className="ed-copy">
              <div className="ed-index">Domains &amp; reputation</div>
              <h3>Your name on every send</h3>
              <p>
                Add a domain, paste three DNS records, and send from an address people recognize.
                Then watch its health — bounce rate, complaint rate, verification state — without
                opening a second tool.
              </p>
              <ul className="ed-list">
                <li>Guided SPF, DKIM, and DMARC setup</li>
                <li>Per-domain delivery health at a glance</li>
                <li>Stale verifications cleaned up automatically</li>
              </ul>
            </Reveal>
            <Reveal delay={120} className="ed-visual">
              <DomainScene />
            </Reveal>
          </div>

          {/* Templates */}
          <div className="ed-row">
            <span className="ghost-num" data-parallax="0.08" aria-hidden="true">
              ✦
            </span>
            <Reveal className="ed-copy">
              <div className="ed-index">
                Templates <span className="tag info">soon</span>
              </div>
              <h3>Emails your designer would sign off on</h3>
              <p>
                Versioned templates with variables, previews, and publishing — so &ldquo;can you
                tweak the receipt?&rdquo; stops meaning a code deploy. We&rsquo;re building this
                right after the delivery core is bulletproof.
              </p>
              <ul className="ed-list">
                <li>Variables like {"{{ first_name }}"} with safe defaults</li>
                <li>Version history and one-click rollback</li>
                <li>Test sends before anything goes live</li>
              </ul>
            </Reveal>
            <Reveal delay={120} className="ed-visual">
              <TemplateScene />
            </Reveal>
          </div>

          {/* Usage & billing */}
          <div className="ed-row flip">
            <span className="ghost-num" data-parallax="0.08" aria-hidden="true">
              ✦
            </span>
            <Reveal className="ed-copy">
              <div className="ed-index">Usage &amp; billing</div>
              <h3>Know what it costs before finance asks</h3>
              <p>
                Every send is metered from the same durable records as everything else — not a
                counter that drifts. Watch usage climb toward your plan in real time, in naira or
                dollars, with hard limits instead of surprise overages.
              </p>
              <ul className="ed-list">
                <li>Live usage against plan quotas</li>
                <li>Invoices that match your dashboard, always</li>
                <li>NGN and USD plans with receipts included</li>
              </ul>
            </Reveal>
            <Reveal delay={120} className="ed-visual">
              <MeterScene />
            </Reveal>
          </div>
        </div>
      </div>
    </section>
  );
}
