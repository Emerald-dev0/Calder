import { Reveal } from "./reveal";
import { DomainScene } from "./product-scenes";

/**
 * Why Calder, five numbered reasons, editorial rows, no bullet lists.
 * Visuals carry the detail the prose deliberately skips.
 */
export function Capabilities() {
  return (
    <section className="section" id="capabilities" style={{ paddingTop: 0 }}>
      <div className="wrap">
        <Reveal>
          <p className="eyebrow">Why Calder</p>
          <h2 className="h2">
            Sending an email is easy. Sending it once, knowing it arrived, and being able to prove
            that a month later: <em>that is the job.</em>
          </h2>
        </Reveal>

        <div style={{ marginTop: "2rem" }}>
          {/* 01, Async by default */}
          <div className="ed-row">
            <span className="ghost-num" data-parallax="0.08" aria-hidden="true">
              01
            </span>
            <Reveal className="ed-copy">
              <div className="ed-index">01, Async by default</div>
              <h3>Your API never waits on a mail server</h3>
              <p>
                Providers throttle and networks stall, but neither is your request&rsquo;s problem.
                We write it down, queue it and answer in milliseconds; the waiting happens somewhere
                built for it.
              </p>
            </Reveal>
            <Reveal delay={120} className="ed-visual">
              <div className="minilog">
                <div className="minilog-row">
                  <span className="status-dot ok" />
                  <span className="addr">receipt@example.com</span>
                  <span className="tag ok">delivered</span>
                  <span className="time">1.02s</span>
                </div>
                <div className="minilog-row">
                  <span className="status-dot info" />
                  <span className="addr">otp@example.com</span>
                  <span className="tag info">sending</span>
                  <span className="time">…</span>
                </div>
                <div className="minilog-row">
                  <span className="status-dot warn" />
                  <span className="addr">retry@example.com</span>
                  <span className="tag warn">retry 2/5</span>
                  <span className="time">+4s</span>
                </div>
                <div className="minilog-row">
                  <span className="status-dot bad" />
                  <span className="addr">bounce@example.com</span>
                  <span className="tag bad">bounced</span>
                  <span className="time">0.61s</span>
                </div>
              </div>
            </Reveal>
          </div>

          {/* 02, Idempotent sends */}
          <div className="ed-row flip">
            <span className="ghost-num" data-parallax="0.08" aria-hidden="true">
              02
            </span>
            <Reveal className="ed-copy">
              <div className="ed-index">02, Idempotent sends</div>
              <h3>Nobody gets two receipts</h3>
              <p>
                Your request timed out. Did it send or not? Send an{" "}
                <span className="mono">Idempotency-Key</span> and the retry returns the original
                response instead of a second email.
              </p>
            </Reveal>
            <Reveal delay={120} className="ed-visual">
              <div className="keyline">Idempotency-Key: welcome-user-4815</div>
              <dl className="kv">
                <dt>POST →</dt>
                <dd>202 · created em_9f2k41xq, result stored</dd>
                <dt>POST ↻</dt>
                <dd>200 · same key → original result replayed</dd>
                <dt>emails sent</dt>
                <dd>exactly one, that&rsquo;s the whole point</dd>
              </dl>
            </Reveal>
          </div>

          {/* 03, Events & webhooks */}
          <div className="ed-row">
            <span className="ghost-num" data-parallax="0.08" aria-hidden="true">
              03
            </span>
            <Reveal className="ed-copy">
              <div className="ed-index">03, Events &amp; webhooks</div>
              <h3>Webhooks that show their work</h3>
              <p>
                A webhook that fires once into the void is a wish, not infrastructure. Calder signs
                every event, retries the failures and keeps the delivery record so you can see what
                your endpoint answered.
              </p>
            </Reveal>
            <Reveal delay={120} className="ed-visual">
              <div className="minilog">
                <div className="minilog-row">
                  <span className="status-dot info" />
                  <span className="addr">email.queued → your-url/hook</span>
                  <span className="tag info">200</span>
                  <span className="time">41ms</span>
                </div>
                <div className="minilog-row">
                  <span className="status-dot info" />
                  <span className="addr">email.sent → your-url/hook</span>
                  <span className="tag info">200</span>
                  <span className="time">38ms</span>
                </div>
                <div className="minilog-row">
                  <span className="status-dot ok" />
                  <span className="addr">email.delivered → your-url/hook</span>
                  <span className="tag ok">200</span>
                  <span className="time">44ms</span>
                </div>
                <div className="minilog-row">
                  <span className="status-dot warn" />
                  <span className="addr">email.bounced → your-url/hook</span>
                  <span className="tag warn">retry 1</span>
                  <span className="time">…</span>
                </div>
              </div>
            </Reveal>
          </div>

          {/* 04, Observability */}
          <div className="ed-row flip">
            <span className="ghost-num" data-parallax="0.08" aria-hidden="true">
              04
            </span>
            <Reveal className="ed-copy">
              <div className="ed-index">04, Observability</div>
              <h3>&ldquo;I never got the email.&rdquo; Now you have an answer.</h3>
              <p>
                Every API response carries a request ID. Every email carries a timeline from
                creation to delivery, and the dashboard shows it in the same words as the logs.
              </p>
            </Reveal>
            <Reveal delay={120} className="ed-visual">
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
                      <b>{state}</b>, {detail}
                    </span>
                    <span className="time">{time}</span>
                  </div>
                ))}
              </div>
            </Reveal>
          </div>

          {/* 05, Domains & reputation */}
          <div className="ed-row">
            <span className="ghost-num" data-parallax="0.08" aria-hidden="true">
              05
            </span>
            <Reveal className="ed-copy">
              <div className="ed-index">05, Domains &amp; reputation</div>
              <h3>Your domain, verified. Your reputation, visible.</h3>
              <p>
                An email from <span className="mono">you@yourproduct.com</span> is treated
                differently from one sent through a shared service, by filters and by the person
                reading it. Verify once with three DNS records and keep the credit for your own
                name.
              </p>
            </Reveal>
            <Reveal delay={120} className="ed-visual">
              <DomainScene />
            </Reveal>
          </div>

          {/* TODO(emerald): one-line founder reason for building Calder, first person,
 real, no marketing speak. Fill in before this ships. */}
        </div>
      </div>
    </section>
  );
}
