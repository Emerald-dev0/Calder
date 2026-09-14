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
            Email is easy. <em>Knowing what happened isn&rsquo;t.</em>
          </h2>
          <p className="lede" style={{ marginTop: "1.2rem" }}>
            Most services are built around the moment you press Send. Calder is built around
            everything that happens afterward.
          </p>
        </Reveal>

        <div style={{ marginTop: "2rem" }}>
          {/* 01 · Reliability */}
          <div className="ed-row">
            <span className="ghost-num" data-parallax="0.08" aria-hidden="true">
              01
            </span>
            <Reveal className="ed-copy">
              <div className="ed-index">01 · Reliability</div>
              <h3>Your API doesn&rsquo;t wait around.</h3>
              <p>
                Providers slow down. Networks fail. Systems retry. Your application shouldn&rsquo;t
                have to care. Calder accepts the request, records it, and keeps the delivery moving
                in the background.
              </p>
            </Reveal>
            <Reveal delay={120} className="ed-visual">
              <div className="minilog">
                <div className="minilog-row">
                  <span className="status-dot ok" />
                  <span className="addr">receipt@example.com</span>
                  <span className="tag ok">delivered</span>
                </div>
                <div className="minilog-row">
                  <span className="status-dot info" />
                  <span className="addr">otp@example.com</span>
                  <span className="tag info">sending</span>
                </div>
              </div>
            </Reveal>
          </div>

          {/* 02 · Idempotency */}
          <div className="ed-row flip">
            <span className="ghost-num" data-parallax="0.08" aria-hidden="true">
              02
            </span>
            <Reveal className="ed-copy">
              <div className="ed-index">02 · Idempotency</div>
              <h3>Retry without sending twice.</h3>
              <p>
                Requests fail sometimes. With an idempotency key, retrying the same request
                doesn&rsquo;t create another message. Same request. Same result.
              </p>
            </Reveal>
            <Reveal delay={120} className="ed-visual">
              <div className="keyline">Idempotency-Key: welcome-user-4815</div>
              <div style={{ marginTop: "1rem" }}>
                <p className="caption">Same key &rarr; Original result replayed</p>
              </div>
            </Reveal>
          </div>

          {/* 03 · Events */}
          <div className="ed-row">
            <span className="ghost-num" data-parallax="0.08" aria-hidden="true">
              03
            </span>
            <Reveal className="ed-copy">
              <div className="ed-index">03 · Events</div>
              <h3>Every important moment becomes an event.</h3>
              <p>
                Queued. Sent. Delivered. Bounced. Opened. Clicked. Your application can react to
                those events through signed, retried webhooks.
              </p>
            </Reveal>
            <Reveal delay={120} className="ed-visual">
              <div className="minilog">
                {["email.sent", "email.delivered", "email.opened"].map((e) => (
                  <div className="minilog-row" key={e}>
                    <span className="status-dot ok" />
                    <span className="addr">{e}</span>
                    <span className="tag ok">200 OK</span>
                  </div>
                ))}
              </div>
            </Reveal>
          </div>

          {/* 04 · Observability */}
          <div className="ed-row flip">
            <span className="ghost-num" data-parallax="0.08" aria-hidden="true">
              04
            </span>
            <Reveal className="ed-copy">
              <div className="ed-index">04 · Observability</div>
              <h3>When someone says &ldquo;I didn&rsquo;t get the email,&rdquo; you have an answer.</h3>
              <p>
                See the complete timeline. <strong>Created &rarr; Queued &rarr; Sent &rarr; Delivered</strong>. With request IDs,
                provider responses, timestamps, retries, and delivery events attached.
              </p>
            </Reveal>
            <Reveal delay={120} className="ed-visual">
              <div className="minilog">
                <div className="minilog-row">
                  <span className="status-dot info" />
                  <span className="addr">
                    <b>Sent</b>, Provider accepted
                  </span>
                  <span className="time">t+340ms</span>
                </div>
                <div className="minilog-row">
                  <span className="status-dot ok" />
                  <span className="addr">
                    <b>Delivered</b>, Inbox confirmed
                  </span>
                  <span className="time">t+1.02s</span>
                </div>
              </div>
            </Reveal>
          </div>

          {/* 05 · Deliverability */}
          <div className="ed-row">
            <span className="ghost-num" data-parallax="0.08" aria-hidden="true">
              05
            </span>
            <Reveal className="ed-copy">
              <div className="ed-index">05 · Deliverability</div>
              <h3>Your reputation shouldn&rsquo;t be invisible.</h3>
              <p>
                Verify your domain. Authenticate your mail. Understand your delivery performance.
                Keep transactional and campaign communication properly separated. Calder gives you
                the infrastructure and visibility to operate it responsibly.
              </p>
            </Reveal>
            <Reveal delay={120} className="ed-visual">
              <DomainScene />
            </Reveal>
          </div>
        </div>
      </div>
    </section>
  );
}
