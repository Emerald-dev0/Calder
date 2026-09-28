import type { Metadata } from "next";
import { Navigation } from "../../components/navigation";
import { Footer } from "../../components/closing";
import { PageHero } from "../../components/page-hero";
import { WaitlistForm } from "../../components/waitlist-form";
import { Reveal } from "../../components/reveal";

export const metadata: Metadata = {
  title: "Waitlist, Calder",
  description:
    "Everything your application needs to communicate. Join the waitlist to get early access to Calder.",
};

const NEXT_STEPS = [
  [
    "One place for your communication.",
    <>
      Your application has a lot to say. Verification codes. Receipts. Notifications. Product
      updates. Campaigns. Announcements.
      <br />
      <br />
      Calder brings these communication workflows together with the infrastructure to send, observe,
      and manage them.
    </>,
  ],
  [
    "Built for developers. Designed for everyone else.",
    <>
      Connect Calder to your application through APIs, SMTP, SDKs, and webhooks.
      <br />
      <br />
      Then manage what happens after the send — with templates, delivery data, audiences,
      automations, and the controls your team needs as you grow. No stitching together a collection
      of disconnected tools just to communicate with your users.
    </>,
  ],
  [
    "You're joining early. Stay close.",
    <>
      We're building Calder piece by piece, and we'll be sharing the journey along the way.
      <br />
      <br />
      Over the coming days and weeks, you may hear directly from <strong>our founder</strong> and
      the Calder team about what we're building, new capabilities, important milestones, and
      opportunities to get involved early.
      <br />
      <br />
      If you have an idea, a use case, or something you think Calder should do differently,{" "}
      <strong>we'd genuinely like to hear it.</strong>
      <br />
      <br />
      You're not just leaving an email address. <strong>You're getting in early.</strong>
    </>,
  ],
] as const;

export default function WaitlistPage() {
  return (
    <>
      <Navigation />
      <main>
        <PageHero
          eyebrow="Communication infrastructure · early access"
          title="Everything your application needs to communicate."
          lede={
            <>
              Calder brings the infrastructure behind application communication into one place —
              from transactional messages and notifications to campaigns, audiences, automations,
              and preferences.
              <br />
              <br />
              We&rsquo;re building Calder for teams that want their communication to be{" "}
              <strong>reliable, observable, and easy to operate.</strong>
              <br />
              <br />
              Join the waitlist to get early access and follow Calder as we build.
            </>
          }
        />
        <section className="section" style={{ paddingTop: 0 }}>
          <div className="wrap">
            <Reveal>
              <WaitlistForm />
            </Reveal>
            <div style={{ marginTop: "3rem" }}>
              {NEXT_STEPS.map(([title, body], i) => (
                <div className="ed-row" key={title} style={{ padding: "1.6rem 0" }}>
                  <Reveal>
                    <div className="ed-index">0{i + 1}</div>
                    <h3
                      style={{
                        margin: 0,
                        fontSize: "1.35rem",
                        letterSpacing: "-0.015em",
                        fontWeight: 700,
                      }}
                    >
                      {title}
                    </h3>
                  </Reveal>
                  <Reveal delay={80}>
                    <div style={{ margin: "1rem 0 0", color: "var(--ink-soft)", lineHeight: 1.7 }}>
                      {body}
                    </div>
                  </Reveal>
                </div>
              ))}
            </div>

            <Reveal delay={120}>
              <div
                style={{
                  marginTop: "6rem",
                  textAlign: "center",
                  borderTop: "1px solid var(--border)",
                  paddingTop: "6rem",
                }}
              >
                <h2 className="h2" style={{ marginBottom: "1.5rem" }}>
                  Let&rsquo;s build better communication infrastructure.
                </h2>
                <a href="#top" className="btn btn-primary">
                  Join the Calder waitlist &rarr;
                </a>
                <p className="caption" style={{ marginTop: "1rem" }}>
                  We&rsquo;ll be in touch.
                </p>
              </div>
            </Reveal>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
