import type { Metadata } from "next";
import { Navigation } from "../../components/navigation";
import { FinalCta, Footer } from "../../components/closing";
import { PageHero } from "../../components/page-hero";
import { Reveal } from "../../components/reveal";

export const metadata: Metadata = {
 title: "About, Calder",
 description: "Why Calder exists: communication infrastructure that gets out of your way.",
};

const PRINCIPLES = [
 [
 "Boring where it counts",
 "Infrastructure should be predictable. We save the excitement for the design and spend it nowhere else.",
 ],
 [
 "Debuggability is a feature",
 "Every operation leaves a trail. If you can't inspect it, we didn't finish building it.",
 ],
 [
 "Transactional first, only",
 "We will not become a newsletter platform. Focus is a deliverability strategy.",
 ],
 [
 "Honest pricing",
 "Naira and dollars, hard limits, metered from records. The invoice matches the dashboard or it's a bug.",
 ],
 [
 "Design is infrastructure too",
 "Developer tools deserve the same craft as consumer products. This page is the argument.",
 ],
] as const;

export default function AboutPage() {
 return (
 <>
 <Navigation />
 <main>
 <PageHero
 eyebrow="About"
 title={
 <>
 Infrastructure that <em>gets out of your way.</em>
 </>
 }
 lede="Calder started from a simple frustration: sending an email from an application should be one API call, but doing it well means providers, DNS, queues, retries, webhooks, suppression, and billing, fragmented across six vendors. We're assembling it into one coherent system."
 />
 <section className="section" style={{ paddingTop: 0 }}>
 <div className="wrap">
 <Reveal>
 <p className="eyebrow">How we work</p>
 <h2 className="h2">
 Five principles, <em>actually enforced.</em>
 </h2>
 </Reveal>
 <div style={{ marginTop: "1rem" }}>
 {PRINCIPLES.map(([title, body], i) => (
 <div className="ed-row" key={title} style={{ padding: "1.8rem 0" }}>
 <Reveal>
 <div className="ed-index">0{i + 1}</div>
 <h3 style={{ margin: 0, fontSize: "1.3rem", letterSpacing: "-0.015em" }}>
 {title}
 </h3>
 </Reveal>
 <Reveal delay={80}>
 <p style={{ margin: 0, color: "var(--ink-soft)" }}>{body}</p>
 </Reveal>
 </div>
 ))}
 </div>
 <Reveal delay={100}>
 <div style={{ marginTop: "3rem", display: "flex", justifyContent: "center" }}>
 <a className="btn btn-primary" href="/waitlist">
 Join the waitlist{" "}
 <span className="arrow" aria-hidden="true">
 →
 </span>
 </a>
 </div>
 </Reveal>
 </div>
 </section>
 <FinalCta />
 </main>
 <Footer />
 </>
 );
}
