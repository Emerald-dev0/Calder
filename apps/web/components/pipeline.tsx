import { Reveal } from "./reveal";

/**
 * "Make the invisible visible", the real Calder flow from ARCHITECTURE.md:
 * Client → API (validate → persist → enqueue → 202) → Worker → SES → events → webhooks.
 */
export function Pipeline() {
  return (
    <section className="section" id="pipeline">
      <div className="wrap">
        <Reveal>
          <p className="eyebrow">How Calder works</p>
          <h2 className="h2">
            Your application talks. <em>Calder handles the rest.</em>
          </h2>
          <p className="lede" style={{ marginTop: "1.2rem" }}>
            Your code shouldn&rsquo;t have to know how queues work, which provider is available,
            whether a delivery failed, or how many times a webhook needs to retry. That&rsquo;s
            Calder&rsquo;s job.
          </p>
        </Reveal>

        <div className="pipeline-v2">
          <Reveal delay={100} className="pipeline-step">
            <div className="step-number">01</div>
            <div className="step-content">
              <h3>Your application</h3>
              <p>
                <strong>Make one request.</strong> Send through the API or use SMTP. Add an
                idempotency key when you need guaranteed retry behavior.
              </p>
              <div className="step-meta">
                API or SMTP &middot; <code>Idempotency-Key</code> supported
              </div>
            </div>
          </Reveal>

          <Reveal delay={200} className="pipeline-step">
            <div className="step-number">02</div>
            <div className="step-content">
              <h3>Calder</h3>
              <p>
                <strong>We validate, record, and queue it.</strong> Your request gets a fast
                response while Calder takes care of everything that comes after.
              </p>
              <div className="step-meta">Validate &rarr; Record &rarr; Queue</div>
            </div>
          </Reveal>

          <Reveal delay={300} className="pipeline-step">
            <div className="step-number">03</div>
            <div className="step-content">
              <h3>Delivery</h3>
              <p>
                <strong>We keep it moving.</strong> Workers process the message, retry temporary
                failures, and route it through the delivery infrastructure.
              </p>
              <div className="step-meta">Automatic retries · Smart routing</div>
            </div>
          </Reveal>

          <Reveal delay={400} className="pipeline-step">
            <div className="step-number">04</div>
            <div className="step-content">
              <h3>Your recipient</h3>
              <p>
                <strong>It arrives.</strong> Delivery and engagement signals come back to Calder.
              </p>
              <div className="step-meta">Signal capture · Real-time status</div>
            </div>
          </Reveal>

          <Reveal delay={500} className="pipeline-step">
            <div className="step-number">05</div>
            <div className="step-content">
              <h3>Your dashboard</h3>
              <p>
                <strong>You can see exactly what happened.</strong> Every important step becomes an
                event you can inspect, search, and act on.
              </p>
              <div className="step-meta">Full lifecycle events · Event logs</div>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

const STACK = [
  ["API", "Hono · 202 in milliseconds"],
  ["Queue", "Redis-backed · retries with backoff"],
  ["Store", "PostgreSQL · source of truth"],
  ["Delivery", "AWS SES · provider abstraction"],
  ["Events", "Full lifecycle · signed webhooks"],
  ["Billing", "₦ and $ · metered from the same records as your logs"],
] as const;

export function StackStrip() {
  const items = [...STACK, ...STACK];
  return (
    <div className="stack-strip" aria-label="Calder platform stack">
      <div className="stack-track" aria-hidden="true">
        {items.map(([k, v], i) => (
          <span key={i}>
            <b>{k}</b>, {v}
          </span>
        ))}
      </div>
    </div>
  );
}
