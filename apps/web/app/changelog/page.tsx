import type { Metadata } from "next";
import { Navigation } from "../../components/navigation";
import { Footer } from "../../components/closing";
import { PageHero } from "../../components/page-hero";
import { Reveal } from "../../components/reveal";

export const metadata: Metadata = {
  title: "Changelog — Avenor",
  description: "What shipped at Avenor, in order. No hype, just the work.",
};

const ENTRIES = [
  {
    date: "Sep 2026",
    title: "Brand identity + illustration system",
    points: [
      "Final signal-route mark, path-built AVENOR wordmark, lockups, favicon",
      "Etching-style illustration language across landing and dashboard",
      "404 page that treats missing routes like failed deliveries",
    ],
  },
  {
    date: "Sep 2026",
    title: "Landing page v1",
    points: [
      "Editorial Infrastructure design system in light mode",
      "Live send visualization, pipeline diagram, SDK tabs (cURL, Node, Python)",
      "Honest pricing with NGN/USD toggle",
    ],
  },
  {
    date: "Sep 2026",
    title: "Foundation scaffold",
    points: [
      "Monorepo: API, worker, dashboard, and eleven shared packages",
      "Idempotent send pipeline: validate → persist → enqueue → 202",
      "Drizzle schema + migrations, SES provider abstraction, mock billing",
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
              What shipped, <em>in order.</em>
            </>
          }
          lede="No hype, no 'we're thrilled to announce.' Just the work, newest first — including the unglamorous foundation weeks."
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
