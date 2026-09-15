import type { Metadata } from "next";
import { Navigation } from "../../components/navigation";
import { Footer } from "../../components/closing";
import { PageHero } from "../../components/page-hero";
import { WaitlistForm } from "../../components/waitlist-form";
import { Reveal } from "../../components/reveal";

export const metadata: Metadata = {
  title: "Early access, Calder",
  description:
    "Calder is building a better way for applications and teams to communicate. Join the waitlist and be there from the beginning.",
};

const SECTIONS: Array<{ title: string; body: string[]; list?: string[] }> = [
  {
    title: "Get closer to what we're building.",
    body: [
      "Calder is being built in the open, one piece at a time.",
      "As we build, you'll hear about new capabilities, product milestones, and the ideas we're exploring to make communication infrastructure simpler for developers and teams.",
      "No endless marketing emails. Just Calder.",
    ],
  },
  {
    title: "You're early. That's a good thing.",
    body: [
      "The people joining Calder now aren't just signing up for another product. They're getting in while we're still shaping it.",
      "Over the coming days and weeks, you may hear directly from our founder and the Calder team — sharing what we're working on, what we're learning, and where we're taking the platform.",
      "And if you have something to say, we want to hear it.",
    ],
    list: [
      "A feature you need.",
      "A workflow that drives you crazy.",
      "Something you think we could do better.",
    ],
  },
  {
    title: "Built for the way applications communicate.",
    body: [
      "Your users don't care which provider delivered an email. They care that the verification code arrives. That the receipt shows up. That the notification makes it through. That the right message reaches the right person at the right time.",
      "That's what Calder is here to solve.",
    ],
  },
];

export default function WaitlistPage() {
  return (
    <>
      <Navigation />
      <main>
        <PageHero
          eyebrow="Calder · Early Access"
          title={
            <>
              Something new <em>is taking shape.</em>
            </>
          }
          lede="Calder is building a better way for applications and teams to communicate with the people who use them. Email is only the beginning — we're bringing together the tools for sending, campaigns, audiences, automation, delivery, and everything in between, with the infrastructure and visibility underneath it. Join the Calder waitlist and be there from the beginning."
        />
        <section className="section" style={{ paddingTop: 0 }}>
          <div className="wrap">
            <Reveal>
              <WaitlistForm />
            </Reveal>
            <div style={{ marginTop: "3rem" }}>
              {SECTIONS.map((s, i) => (
                <div className="ed-row" key={s.title} style={{ padding: "1.6rem 0" }}>
                  <Reveal>
                    <div className="ed-index">0{i + 1}</div>
                    <h3 style={{ margin: 0, fontSize: "1.25rem", letterSpacing: "-0.015em" }}>
                      {s.title}
                    </h3>
                  </Reveal>
                  <Reveal delay={80}>
                    <div>
                      {s.body.map((p) => (
                        <p key={p} style={{ margin: "0 0 0.8rem", color: "var(--ink-soft)" }}>
                          {p}
                        </p>
                      ))}
                      {s.list && (
                        <>
                          <p style={{ margin: "0 0 0.4rem", color: "var(--ink-soft)" }}>Tell us.</p>
                          <ul className="ed-list">
                            {s.list.map((item) => (
                              <li key={item}>{item}</li>
                            ))}
                          </ul>
                        </>
                      )}
                    </div>
                  </Reveal>
                </div>
              ))}
            </div>
          </div>
        </section>
        <section className="section" style={{ paddingTop: 0 }}>
          <div className="wrap">
            <Reveal>
              <p className="eyebrow">The beginning</p>
              <h2 className="h2">
                Be part of <em>the beginning.</em>
              </h2>
              <p className="lede" style={{ marginTop: "1.2rem" }}>
                Join the people who will be among the first to experience Calder as it grows.
              </p>
            </Reveal>
            <div style={{ marginTop: "2rem" }}>
              <Reveal>
                <WaitlistForm idPrefix="waitlist-final" />
              </Reveal>
              <Reveal delay={80}>
                <p style={{ marginTop: "1.2rem", color: "var(--ink-soft)" }}>
                  We&rsquo;ll be in touch.
                </p>
              </Reveal>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
