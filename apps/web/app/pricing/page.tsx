import type { Metadata } from "next";
import { pageMeta } from "../../lib/seo";
import { Navigation } from "../../components/navigation";
import { Pricing } from "../../components/pricing";
import { PlanComparison } from "../../components/pricing-table";
import { Streams } from "../../components/streams";
import { FinalCta, Footer } from "../../components/closing";
import { PageHero } from "../../components/page-hero";
import { Reveal } from "../../components/reveal";
import { PRICING_FAQS } from "../../lib/plans";

export const metadata: Metadata = pageMeta({
  title: "Pricing",
  description:
    "Beginner is free: 5,000 emails, 3 projects, 2 domains. Pro is $15 or ₦25,000 for 50,000 emails and production environments. Premium is $49 or ₦75,000 for 250,000. Naira and dollar prices are separate decisions, not conversions.",
  path: "/pricing",
});

/** What happens at the limit, answered before anyone has to ask. */
const LIMITS = [
  {
    title: "You get an error, not a bill",
    body: "Hitting a quota returns a clear failure that names the limit, your usage, and when it resets. Nothing is charged automatically and nothing is silently dropped.",
  },
  {
    title: "Retries never double-count",
    body: "One accepted send is one email on the meter. Provider retries, idempotent replays, and webhook redeliveries are ours to absorb, not yours to pay for.",
  },
  {
    title: "Test keys never meter",
    body: "Test sends run the full pipeline, queue, events, webhooks, and are not counted against your plan. Build the integration before you send a single real email.",
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
              A free tier you can actually <em>build a product on.</em>
            </>
          }
          lede="Five thousand emails a month at ₦0, no card, no trial clock. When your app outgrows it, Pro is $15 or ₦25,000 for fifty thousand sends with production environments. Two currencies, two real prices, no conversion games."
        />
        <div style={{ paddingBottom: "2rem" }}>
          <Pricing />
        </div>

        <Streams />

        <section className="section" style={{ paddingTop: 0 }}>
          <div className="wrap">
            <Reveal>
              <p className="eyebrow">At the limit</p>
              <h2 className="h2">
                What happens when you run out, <em>stated plainly.</em>
              </h2>
            </Reveal>
            <div className="limit-grid">
              {LIMITS.map((l, i) => (
                <Reveal key={l.title} delay={i * 80}>
                  <div className="limit-item">
                    <h3>{l.title}</h3>
                    <p>{l.body}</p>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        <PlanComparison />

        <section className="section" style={{ paddingTop: 0 }}>
          <div className="wrap">
            <Reveal>
              <p className="eyebrow">Questions, answered</p>
              <h2 className="h2">
                Fair questions <em>deserve straight answers.</em>
              </h2>
            </Reveal>
            <div style={{ marginTop: "2rem" }}>
              {PRICING_FAQS.map((f) => (
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
