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
 <p className="eyebrow">How it works</p>
 <h2 className="h2">
 Most email APIs are a black box <em>with a prayer inside.</em>
 </h2>
 <p className="lede" style={{ marginTop: "1.2rem" }}>
 Here&rsquo;s ours with the lid off: your request is validated, stored, and queued in
 milliseconds, then a worker walks the email to the provider and writes down everything
 that happens.
 </p>
 </Reveal>
 <Reveal delay={120}>
 <div className="pipeline">
 <div className="pipeline-flow">
 <div className="pnode">
 <div className="pnode-kicker">01 · You</div>
 <div className="pnode-title">Your application</div>
 <div className="pnode-sub">One POST. Idempotency-Key header, Bearer API key.</div>
 </div>
 <div className="plink" aria-hidden="true" />
 <div className="pnode hero-node">
 <div className="pnode-kicker">02 · Calder API</div>
 <div className="pnode-title">Validate → persist → enqueue</div>
 <div className="pnode-sub">Responds 202 Accepted. Nothing blocks on delivery.</div>
 </div>
 <div className="plink" aria-hidden="true" />
 <div className="pnode">
 <div className="pnode-kicker">03 · Worker</div>
 <div className="pnode-title">Send &amp; retry</div>
 <div className="pnode-sub">
 Backoff with jitter. Dead-letter, never silent loss.
 </div>
 </div>
 <div className="plink" aria-hidden="true" />
 <div className="pnode">
 <div className="pnode-kicker">04 · Provider</div>
 <div className="pnode-title">AWS SES</div>
 <div className="pnode-sub">Behind an abstraction, swappable, failover-ready.</div>
 </div>
 <div className="plink" aria-hidden="true" />
 <div className="pnode">
 <div className="pnode-kicker">05 · Inbox</div>
 <div className="pnode-title">Delivered</div>
 <div className="pnode-sub">Bounce and complaint signals flow back as events.</div>
 </div>
 </div>
 <div className="pipeline-return">
 <span>every step emits →</span>
 <span className="event-pill">email.queued</span>
 <span className="event-pill">email.sent</span>
 <span className="event-pill">email.delivered</span>
 <span className="event-pill">email.bounced</span>
 <span>signed webhooks · retried with history</span>
 </div>
 </div>
 </Reveal>
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
 ["Billing", "NGN + USD · predictable plans"],
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
