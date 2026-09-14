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
    title: "A logo that looks like us",
    points: [
      "New wordmark, favicon, and the signal motif you'll see across the product",
      "Hand-drawn illustration style for the site and dashboard empty states",
      "A 404 page that reads like a delivery log, because of course it does",
    ],
  },
  {
    date: "Sep 2026",
    title: "The site you're reading",
    points: [
      "Watch a test email travel queued → sent → delivered, live on the homepage",
      "Copy-paste sending examples in cURL, Node, and Python",
      "Pricing in naira and dollars, with the honest math attached",
    ],
  },
  {
    date: "Sep 2026",
    title: "The engine room",
    points: [
      "Send pipeline live: every request validated, stored, queued, and answered in milliseconds",
      "Safe retries built in, send the same request twice, deliver exactly once",
      "Full event history on every email, from queued to opened",
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
          lede="No hype, no 'we're thrilled to announce.' Just the work, newest first, including the unglamorous foundation weeks."
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
