import { Reveal } from "./reveal";

/**
 * Core capabilities as editorial rows with ghost numerals — never a card grid.
 * Every claim maps to a real architectural behavior. The .ed-visual panels
 * are sized to accept sourced illustrations later without layout changes.
 */
export function Capabilities() {
  return (
    <section className="section" id="capabilities" style={{ paddingTop: 0 }}>
      <div className="wrap">
        <Reveal>
          <p className="eyebrow">Why Avenor</p>
          <h2 className="h2">
            The boring parts, <em>done properly.</em>
          </h2>
          <p className="lede" style={{ marginTop: "1.2rem" }}>
            Sending an email is easy. Sending it exactly once, knowing it arrived, and proving it
            later — that&rsquo;s the job. Here&rsquo;s how Avenor handles it.
          </p>
        </Reveal>

        <div style={{ marginTop: "2rem" }}>
          {/* 01 — async */}
          <div className="ed-row">
            <span className="ghost-num" data-parallax="0.08" aria-hidden="true">
              01
            </span>
            <Reveal className="ed-copy">
              <div className="ed-index">01 — Async by default</div>
              <h3>Your API never waits on a mail server</h3>
              <p>
                Providers throttle. Networks stall. DNS takes its time. None of that should be your
                user&rsquo;s problem — or your p99&rsquo;s. We persist the email, enqueue the job,
                and answer in milliseconds. Delivery happens on infrastructure built for waiting.
              </p>
              <ul className="ed-list">
                <li>202 Accepted while the provider is still waking up</li>
                <li>Transient failures retried with backoff + jitter, not hope</li>
                <li>Exhausted jobs wait in dead-letter — replayable, never vanished</li>
              </ul>
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
                  <span className="status-dot ok" />
                  <span className="addr">verify@example.com</span>
                  <span className="tag ok">delivered</span>
                  <span className="time">0.94s</span>
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
              <p className="caption" style={{ marginTop: "1rem" }}>
                Queue depth, attempts, outcomes — visible, never silent.
              </p>
            </Reveal>
          </div>

          {/* 02 — idempotency */}
          <div className="ed-row flip">
            <span className="ghost-num" data-parallax="0.08" aria-hidden="true">
              02
            </span>
            <Reveal className="ed-copy">
              <div className="ed-index">02 — Idempotent sends</div>
              <h3>Nobody gets two receipts</h3>
              <p>
                Your request timed out — but did the email send? Without an answer, your code
                retries and your customer gets the receipt twice. Hand us an{" "}
                <span className="mono">Idempotency-Key</span> and the retry returns the original
                result. Same key, same outcome, one email.
              </p>
              <ul className="ed-list">
                <li>Keys stored durably per project, good for 24 hours</li>
                <li>Retry freely on timeouts and 5xx — it&rsquo;s safe now</li>
                <li>Metered exactly once, so billing matches reality</li>
              </ul>
            </Reveal>
            <Reveal delay={120} className="ed-visual">
              <div className="keyline">Idempotency-Key: welcome-user-4815</div>
              <dl className="kv">
                <dt>POST →</dt>
                <dd>202 · created em_9f2k41xq, result stored</dd>
                <dt>POST ↻</dt>
                <dd>200 · same key → original result replayed</dd>
                <dt>emails sent</dt>
                <dd>exactly one — that&rsquo;s the whole point</dd>
              </dl>
            </Reveal>
          </div>

          {/* 03 — webhooks + suppression */}
          <div className="ed-row">
            <span className="ghost-num" data-parallax="0.08" aria-hidden="true">
              03
            </span>
            <Reveal className="ed-copy">
              <div className="ed-index">03 — Events &amp; webhooks</div>
              <h3>Webhooks that show their work</h3>
              <p>
                A webhook that fires once into the void isn&rsquo;t infrastructure — it&rsquo;s a
                wish. Every send fans out signed events with delivery attempts you can inspect and
                replay. And addresses that bounced or complained? Blocked before sending, with the
                reason logged — never silently swallowed.
              </p>
              <ul className="ed-list">
                <li>HMAC-signed payloads with idempotent event IDs</li>
                <li>Background delivery with visible retry history</li>
                <li>Suppression checked before every single send</li>
              </ul>
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
              <p className="caption" style={{ marginTop: "1rem" }}>
                Verifiable signatures, inspectable failures, one-click replays.
              </p>
            </Reveal>
          </div>
        </div>
      </div>
    </section>
  );
}
