import { Reveal } from "./reveal";

/**
 * The differentiator, made visual: two streams that never share a reputation.
 */
export function Streams() {
  return (
    <section className="section" id="streams">
      <div className="wrap">
        <Reveal>
          <p className="eyebrow">Two streams, one platform</p>
          <h2 className="h2">
            An OTP is not a newsletter. <em>They should not share a reputation.</em>
          </h2>
          <p className="lede" style={{ marginTop: "1.2rem" }}>
            Run application mail and campaign mail through one provider and a bad campaign week
            becomes a broken login. Calder keeps them on separate streams with separate suppression,
            consent and rate limits, behind the same API and the same log.
          </p>
        </Reveal>

        <Reveal delay={60}>
          <div className="pipeline-return" style={{ marginTop: "1.6rem" }}>
            <span>one pipeline underneath →</span>
            <span className="event-pill">same API</span>
            <span className="event-pill">same event log</span>
            <span className="event-pill">same webhooks</span>
            <span className="event-pill">same quota meter</span>
            <span>marketing stream ships to every plan, including Beginner</span>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
