import type { Metadata } from "next";
import { Navigation } from "../../components/navigation";
import { Footer } from "../../components/closing";
import { PageHero } from "../../components/page-hero";
import { Reveal } from "../../components/reveal";

export const metadata: Metadata = {
  title: "Status, Calder",
  description:
    "Calder's operational status page: what is monitored today and where incident history is published.",
};

/**
 * Honesty rule (§26): this page may only claim what the system can prove.
 *
 * Today that means: liveness/readiness endpoints exist and are monitored
 * internally; per-component public uptime history does not exist yet. Each row
 * therefore says what is actually known, and "history" rows are explicitly
 * "not published" instead of implying live instrumentation.
 */
const COMPONENTS = [
  {
    name: "API",
    desc: "Request validation, auth, enqueue",
    monitoring: "liveness + readiness endpoints live; monitored internally",
  },
  {
    name: "Workers",
    desc: "Send execution, retries, webhooks",
    monitoring: "worker health endpoint + queue metrics live; monitored internally",
  },
  {
    name: "Email delivery (SES)",
    desc: "Provider acceptance and sending",
    monitoring: "provider errors alert internally; no public history yet",
  },
  {
    name: "Webhooks",
    desc: "Event fan-out and retries",
    monitoring: "delivery failures alert internally; no public history yet",
  },
  {
    name: "Dashboard",
    desc: "app.calder.click",
    monitoring: "not separately monitored yet",
  },
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
          lede="What is monitored today, stated plainly, and the incident history as it is published. This page does not show live per-component uptime yet: that data is collected internally and will be surfaced here once it is real. An infrastructure company that hides its incidents is selling you a story, and one that fakes a green dashboard is selling a worse one."
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
                  <span className="uptime">{c.monitoring}</span>
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
                      No incidents recorded yet, the platform is young, and we intend to keep this
                      list boring.
                    </span>
                    <span className="time">all time</span>
                  </div>
                </div>
                <p className="caption" style={{ marginTop: "1rem" }}>
                  When something breaks, it is recorded here with a timeline and a postmortem. Past
                  incidents will only be published with dates we can evidence; there are none to
                  show yet.
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
