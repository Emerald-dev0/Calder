import type { Metadata } from "next";
import { Navigation } from "../../components/navigation";
import { Footer } from "../../components/closing";
import { PageHero } from "../../components/page-hero";
import { Reveal } from "../../components/reveal";

export const metadata: Metadata = {
  title: "Changelog, Calder",
  description: "What shipped at Calder, in order. No hype, just the work.",
};

const ENTRIES = [
  {
    date: "Sep 2026",
    title: "A new home for Calder",
    points: [
      "Rebuilt the public site around the core idea: communication infrastructure for applications",
      "New visual identity, interactive delivery lifecycle, and updated documentation",
      "Pricing locked in ₦ and $ separately, with honest growth paths",
    ],
  },
  {
    date: "Sep 2026",
    title: "Calder is live",
    points: [
      "REST API for sending email with asynchronous delivery pipeline",
      "Safe retries, idempotency, and full event history on every message",
      "Signed webhooks, SMTP support, and sending domain verification",
      "Projects, API keys, and usage tracking",
    ],
  },
];

export default function ChangelogPage() {
  return (
    <>
      <Navigation />
      <main>
        <PageHero
          eyebrow="The Calder build log"
          title="Changelog"
          lede="A running record of what we&rsquo;re shipping, improving, and learning as Calder grows. No hype. Just the work."
        />
        <section className="section" style={{ paddingTop: 0 }}>
          <div className="wrap">
            {ENTRIES.map((e) => (
              <Reveal key={e.title}>
                <div className="change-entry">
                  <span className="change-date">{e.date}</span>
                  <div>
                    <h3>{e.title}</h3>
                    <ul>
                      {e.points.map((p) => (
                        <li key={p}>{p}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
