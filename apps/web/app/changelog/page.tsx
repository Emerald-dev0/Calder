import type { Metadata } from "next";
import { Navigation } from "../../components/navigation";
import { Footer } from "../../components/closing";
import { PageHero } from "../../components/page-hero";
import { Reveal } from "../../components/reveal";

export const metadata: Metadata = {
  title: "Changelog, Calder",
  description: "A running record of what we're shipping, improving, and learning as Calder grows.",
};

const ENTRIES = [
  {
    date: "September 2026",
    tag: "Platform",
    title: "Calder is live",
    points: [
      "REST API for sending email",
      "Asynchronous delivery pipeline",
      "Idempotent requests",
      "Automatic retries",
      "Signed webhooks",
      "Delivery and event history",
      "SMTP support",
      "Sending domain verification",
      "Projects and API keys",
      "Usage tracking",
    ],
  },
  {
    date: "September 2026",
    tag: "Website",
    title: "A new home for Calder",
    points: [
      "New visual identity",
      "New homepage",
      "Developer-focused product pages",
      "Pricing in ₦ and $",
      "Interactive delivery lifecycle",
      "Updated documentation",
    ],
  },
];

export default function ChangelogPage() {
  return (
    <>
      <Navigation />
      <main>
        <PageHero
          eyebrow="Changelog"
          title={
            <>
              The Calder <em>build log.</em>
            </>
          }
          lede="A running record of what we're shipping, improving, and learning as Calder grows. No hype. Just the work."
        />
        <section className="section" style={{ paddingTop: 0 }}>
          <div className="wrap">
            <p className="eyebrow">September 2026</p>
            {ENTRIES.map((e) => (
              <Reveal key={e.title}>
                <div className="change-entry">
                  <span className="change-date">
                    {e.date} · {e.tag}
                  </span>
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
            <Reveal>
              <p style={{ marginTop: "2rem", color: "var(--ink-soft)" }}>This is the beginning.</p>
            </Reveal>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
