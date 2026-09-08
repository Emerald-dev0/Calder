import type { Metadata } from "next";
import { Navigation } from "../../components/navigation";
import { Footer } from "../../components/closing";
import { PageHero } from "../../components/page-hero";
import { Reveal } from "../../components/reveal";

export const metadata: Metadata = {
  title: "Status — Calder",
  description:
    "Live operational status of the Calder platform: API, workers, providers, and webhooks.",
};

const COMPONENTS = [
  { name: "API", desc: "Request validation, auth, enqueue" },
  { name: "Workers", desc: "Send execution, retries, webhooks" },
  { name: "Email delivery (SES)", desc: "Provider acceptance and sending" },
  { name: "Webhooks", desc: "Event fan-out and retries" },
  { name: "Dashboard", desc: "app.calder.com" },
] as const;

export default function StatusPage() {
  return (
    <>
      <Navigation />
      <main>
        <PageHero
          eyebrow="Status"
          title={
            <>
              Trust through <em>transparency.</em>
            </>
          }
          lede="Every component, its current state, and its history — including the bad days. An infrastructure company that hides its incidents is selling you a story, not a service."
        />
        <section className="section" style={{ paddingTop: 0 }}>
          <div className="wrap">
            <Reveal>
              <div className="status-row">
                <span className="status-dot info" />
                <span className="name">Early access</span>
                <span className="uptime">public history begins at launch</span>
              </div>
              {COMPONENTS.map((c) => (
                <div className="status-row" key={c.name}>
                  <span className="status-dot info" />
                  <span className="name">{c.name}</span>
                  <span className="caption">{c.desc}</span>
                  <span className="uptime">instrumented · /health + /ready live</span>
                </div>
              ))}
            </Reveal>
            <Reveal delay={100}>
              <div className="pipeline" style={{ marginTop: "2rem" }}>
                <p className="eyebrow">Incident history</p>
                <div className="minilog">
                  <div className="minilog-row">
                    <span className="status-dot ok" />
                    <span className="addr">
                      No incidents recorded yet — the platform is young, and we intend to keep this
                      list boring.
                    </span>
                    <span className="time">all time</span>
                  </div>
                </div>
                <p className="caption" style={{ marginTop: "1rem" }}>
                  When something breaks, it goes here with a timeline and a postmortem. Subscribe
                  via webhooks — naturally.
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
