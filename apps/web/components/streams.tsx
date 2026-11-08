import { Reveal } from "./reveal";

/**
 * The differentiator, made visual: two streams that never share a reputation.
 *
 * Structure matters here. Transactional and marketing each get a lane with
 * real event names, so the difference is legible without reading the prose.
 * The marketing lane is labelled Coming Soon and muted rather than drawn as
 * if it were live: broadcasts and audiences are excluded from this release.
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
          <p className="eyebrow">One platform. Different kinds of communication.</p>
          <h2 className="h2">
            Different messages <em>have different jobs.</em>
          </h2>
          <p className="lede" style={{ marginTop: "1.2rem" }}>
            A verification code and a product announcement shouldn&rsquo;t behave the same way.
            Calder is designed to give application and campaign communication the separation they
            need while keeping everything your team uses in one place. Transactional is live today;
            the campaign stream is planned, not available.
          </p>
        </Reveal>

        <div className="lanes">
          <Reveal>
            <div className="lane lane-live">
              <div className="lane-head">
                <h3>Transactional</h3>
              </div>
              <p className="lane-caption">
                The messages your application sends when something happens. Fast, reliable, and
                event-driven.
              </p>
              <div className="lane-events">
                {[
                  "Verification codes",
                  "Password resets",
                  "Receipts",
                  "Invoices",
                  "Security alerts",
                  "Order updates",
                  "Account notifications",
                ].map((name) => (
                  <div className="lane-event" key={name}>
                    <span className="lane-dot" aria-hidden="true" />
                    <span className="lane-name">{name}</span>
                  </div>
                ))}
              </div>
            </div>
          </Reveal>
          <Reveal delay={90}>
            <div className="lane lane-soon">
              <div className="lane-head">
                <h3>Marketing</h3>
                <span className="lane-tag dev">Coming soon</span>
              </div>
              <p className="lane-caption">
                Planned: audiences, consent, scheduling and automation. Not part of this
                release, and not purchasable today.
              </p>
              <div className="lane-events">
                {[
                  "Newsletters",
                  "Announcements",
                  "Product launches",
                  "Promotions",
                  "Re-engagement",
                  "Lifecycle communication",
                  "Campaign analytics",
                ].map((name) => (
                  <div className="lane-event" key={name}>
                    <span className="lane-dot" aria-hidden="true" />
                    <span className="lane-name">{name}</span>
                  </div>
                ))}
              </div>
            </div>
          </Reveal>
        </div>

        <Reveal delay={60}>
          <div
            className="pipeline-return"
            style={{ marginTop: "3rem", justifyContent: "center", gap: "2rem" }}
          >
            <span style={{ fontWeight: 700, color: "var(--ink)" }}>Two streams. One Calder.</span>
            <span>One API</span>
            <span>One event history</span>
            <span>One dashboard</span>
            <span>One place to understand what you&rsquo;re sending</span>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
