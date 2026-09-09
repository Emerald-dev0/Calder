import type { Metadata } from "next";
import { pageMeta } from "../../lib/seo";
import { Navigation } from "../../components/navigation";
import { Pricing } from "../../components/pricing";
import { FinalCta, Footer } from "../../components/closing";
import { PageHero } from "../../components/page-hero";
import { Reveal } from "../../components/reveal";

export const metadata: Metadata = pageMeta({
 title: "Pricing",
 description:
 "Simple, predictable email infrastructure pricing in NGN and USD. Hard limits, no surprise overages, metered from durable records.",
 path: "/pricing",
});

const FAQS = [
 {
 q: "What counts as an email?",
 a: "One accepted send request, a 202 from POST /v1/emails. Webhook deliveries, event reads, and API calls are never metered.",
 },
 {
 q: "What happens when I hit my limit?",
 a: "Sends are held with a clear rate_limit_error, not silently dropped and not billed as overages. Upgrade or wait for the cycle reset, your call, never our surprise.",
 },
 {
 q: "Why both NGN and USD?",
 a: "Calder is built for developers everywhere, including home. Pay in naira by transfer or card, or in dollars, the quota is identical either way.",
 },
 {
 q: "Is there really a free tier?",
 a: "3,000 emails a month, full API, webhooks, and event history included. No credit card, no expiry cliff, it's how we want you to evaluate us.",
 },
 {
 q: "Do test sends count against my quota?",
 a: "No. Test keys simulate the entire pipeline without delivering anything, and none of it is metered.",
 },
];

export default function PricingPage() {
 return (
 <>
 <Navigation />
 <main>
 <PageHero
 eyebrow="Pricing"
 title={
 <>
 Infrastructure economics, <em>not billing theater.</em>
 </>
 }
 lede="Four tiers, two currencies, zero overage traps. Usage is metered from the same durable records as everything else, the invoice always matches your dashboard."
 />
 <div style={{ paddingBottom: "2rem" }}>
 <Pricing />
 </div>
 <section className="section" style={{ paddingTop: 0 }}>
 <div className="wrap">
 <Reveal>
 <p className="eyebrow">Questions, answered</p>
 <h2 className="h2">
 Fair questions <em>deserve straight answers.</em>
 </h2>
 </Reveal>
 <div style={{ marginTop: "2rem" }}>
 {FAQS.map((f) => (
 <Reveal key={f.q}>
 <div className="ed-row" style={{ padding: "1.6rem 0" }}>
 <h3 style={{ margin: 0, fontSize: "1.15rem", letterSpacing: "-0.01em" }}>
 {f.q}
 </h3>
 <p style={{ margin: 0, color: "var(--ink-soft)" }}>{f.a}</p>
 </div>
 </Reveal>
 ))}
 </div>
 </div>
 </section>
 <FinalCta />
 </main>
 <Footer />
 </>
 );
}
