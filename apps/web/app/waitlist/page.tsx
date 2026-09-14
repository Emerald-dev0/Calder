import type { Metadata } from "next";
import { Navigation } from "../../components/navigation";
import { Footer } from "../../components/closing";
import { PageHero } from "../../components/page-hero";
import { WaitlistForm } from "../../components/waitlist-form";
import { Reveal } from "../../components/reveal";

export const metadata: Metadata = {
  title: "Marketing early access, Calder",
  description:
    "Calder's transactional API is open to everyone today. Join the list for early access to campaigns, audiences and automations when they ship.",
};

const NEXT_STEPS = [
  [
    "Take a number",
    "One email, one seat. Your position is computed from real signups as they happen, not from a rounded number we liked the look of.",
  ],
  [
    "Bring people with you",
    "Every signup that arrives through your link queues behind you. Early users get to argue with us about the campaign API before it is frozen.",
  ],
  [
    "Start sending today anyway",
    "Transactional email is open to everyone right now, free, no invite and no card. This list only decides who sees campaigns first.",
  ],
] as const;

export default function WaitlistPage() {
  return (
    <>
      <Navigation />
      <main>
        <PageHero
          eyebrow="Marketing suite · early access"
          title={
            <>
              The transactional API is open. <em>Campaigns are next.</em>
            </>
          }
          lede="Sending verification codes, receipts and alerts through Calder works today, free, the moment you create an account. This list is for the marketing side: campaigns, audiences, automations and the preference center, in the order people joined."
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
                    <h3 style={{ margin: 0, fontSize: "1.25rem", letterSpacing: "-0.015em" }}>
                      {title}
                    </h3>
                  </Reveal>
                  <Reveal delay={80}>
                    <p style={{ margin: 0, color: "var(--ink-soft)" }}>{body}</p>
                  </Reveal>
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
