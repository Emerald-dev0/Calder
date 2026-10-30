import type { Metadata } from "next";
import { Navigation } from "../../components/navigation";
import { Footer } from "../../components/closing";
import { PageHero } from "../../components/page-hero";
import { Reveal } from "../../components/reveal";
import { CHANGELOG } from "../../lib/changelog";

export const metadata: Metadata = {
  alternates: { canonical: "https://calder.click/changelog" },
  title: "Changelog, Calder",
  description: "What shipped at Calder, in order. No hype, just the work.",
};

export default function ChangelogPage() {
  return (
    <>
      <Navigation />
      <main>
        <PageHero
          eyebrow="The Calder build log"
          title="Changelog"
          lede="Selected changes from merged GitHub history. Implementation does not imply production configuration or package publication."
        />
        <section className="section" style={{ paddingTop: 0 }}>
          <div className="wrap">
            {CHANGELOG.map((e) => (
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
                    <p className="caption">
                      Commit evidence:{" "}
                      {e.commits.map((sha, i) => (
                        <span key={sha}>
                          {i > 0 ? " · " : ""}
                          <a href={`https://github.com/Emerald-dev0/Calder/commit/${sha}`}>{sha}</a>
                        </span>
                      ))}
                    </p>
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
