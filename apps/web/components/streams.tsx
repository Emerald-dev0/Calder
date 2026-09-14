import { Reveal } from "./reveal";
import { MARKETING_SUITE } from "../lib/site";

/**
 * The differentiator, made visual: two streams that never share a reputation.
 *
 * Structure matters here. Transactional and marketing each get a lane with
 * real event names, so the difference is legible without reading the prose.
 * The marketing lane is honestly labeled as in development rather than drawn
 * as if it were live.
 */

const TRANSACTIONAL = [
  ["OTP", "verification codes, 2FA"],
  ["password reset", "expiring, single use"],
  ["receipt", "payment confirmed"],
  ["invoice", "attached PDF"],
  ["security alert", "new device, new IP"],
  ["order update", "shipped, delivered"],
] as const;

const MARKETING = [
  ["newsletter", "scheduled, weekly"],
  ["announcement", "product news"],
  ["launch", "to a segment"],
  ["promotion", "to opted-in contacts"],
  ["re-engagement", "after 30 days idle"],
  ["lifecycle", "triggered by events"],
] as const;

function Lane({
  title,
  caption,
  events,
  tone,
  tag,
}: {
  title: string;
  caption: string;
  events: ReadonlyArray<readonly [string, string]>;
  tone: "live" | "dev";
  tag: string;
}) {
  return (
    <div className={`lane lane-${tone}`}>
      <div className="lane-head">
        <h3>{title}</h3>
        <span className={`lane-tag${tone === "dev" ? "dev" : ""}`}>{tag}</span>
      </div>
      <p className="lane-caption">{caption}</p>
      <div className="lane-events">
        {events.map(([name, detail]) => (
          <div className="lane-event" key={name}>
            <span className="lane-dot" aria-hidden="true" />
            <span className="lane-name mono">{name}</span>
            <span className="lane-detail">{detail}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

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

        <div className="lanes">
          <Reveal>
            <Lane
              title="Transactional"
              tag="live today"
              tone="live"
              caption="Mail your application sends because someone did something. Sent immediately, never batched into a campaign, never delayed by one."
              events={TRANSACTIONAL}
            />
          </Reveal>
          <Reveal delay={90}>
            <Lane
              title="Marketing"
              tag="in development"
              tone="dev"
              caption="Mail you decide to send to a list: newsletters, launches, lifecycle. Own audiences, own consent, own reputation, and its own contact allowance on every plan."
              events={MARKETING}
            />
          </Reveal>
        </div>

        <Reveal delay={60}>
          <div className="pipeline-return" style={{ marginTop: "1.6rem" }}>
            <span>one pipeline underneath →</span>
            <span className="event-pill">same API</span>
            <span className="event-pill">same event log</span>
            <span className="event-pill">same webhooks</span>
            <span className="event-pill">same quota meter</span>
            <span>
              {MARKETING_SUITE === "dev"
                ? "marketing stream ships to every plan, including Beginner"
                : "marketing stream is live on every plan"}
            </span>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
