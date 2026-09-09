import type { Metadata } from "next";
import { Navigation } from "../../components/navigation";
import { FinalCta, Footer } from "../../components/closing";
import { PageHero } from "../../components/page-hero";
import { Reveal } from "../../components/reveal";

export const metadata: Metadata = {
 title: "Security, Calder",
 description:
 "How Calder protects your data: key hashing, tenant isolation, webhook signing, and an honest certification roadmap.",
};

const PRACTICES = [
 [
 "API keys hashed at rest",
 "SHA-256 with constant-time comparison. We can show you a prefix; we can never show you the key.",
 ],
 [
 "Tenant isolation at the data layer",
 "Every query scoped by organization and project, not just the route middleware.",
 ],
 [
 "Signed webhooks, verified inbound",
 "HMAC on everything we send; signature checks on everything we accept.",
 ],
 [
 "Secrets stay server-side",
 "Nothing sensitive reaches the browser, the logs, or an error response. Ever.",
 ],
 ["Predictable errors", "Request IDs on every response; stack traces on none of them."],
 ["Dependency hygiene", "Pinned lockfile, scanned in CI, no surprise additions."],
] as const;

export default function SecurityPage() {
 return (
 <>
 <Navigation />
 <main>
 <PageHero
 eyebrow="Security"
 title={
 <>
 Paranoia, <em>documented.</em>
 </>
 }
 lede="We handle credentials, email addresses, and billing data, so we treat all of it as sensitive by default. Here's exactly what that means in practice, and where we are on formal certifications."
 />
 <section className="section" style={{ paddingTop: 0 }}>
 <div className="wrap">
 <div style={{ marginTop: "1rem" }}>
 {PRACTICES.map(([title, body], i) => (
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
 <Reveal>
 <div className="pipeline" style={{ marginTop: "2.5rem" }}>
 <p className="eyebrow">Certifications, honestly</p>
 <div className="minilog">
 <div className="minilog-row">
 <span className="status-dot warn" />
 <span className="addr">
 <b>SOC 2</b>, not yet certified. Controls designed with it in mind; audit
 scheduled before enterprise launch.
 </span>
 <span className="tag warn">roadmap</span>
 </div>
 <div className="minilog-row">
 <span className="status-dot warn" />
 <span className="addr">
 <b>GDPR</b>, data-minimization and deletion workflows built in; formal DPA
 available at launch.
 </span>
 <span className="tag warn">roadmap</span>
 </div>
 <div className="minilog-row">
 <span className="status-dot ok" />
 <span className="addr">
 <b>Transport</b>, encrypted everywhere, strict security headers on all
 surfaces.
 </span>
 <span className="tag ok">live</span>
 </div>
 </div>
 <p className="caption" style={{ marginTop: "1rem" }}>
 We&rsquo;d rather show you a roadmap than a badge we haven&rsquo;t earned.
 </p>
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
