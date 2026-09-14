import type { Metadata } from "next";
import { pageMeta, pricingJsonLd } from "../../lib/seo";
import { Navigation } from "../../components/navigation";
import { Pricing } from "../../components/pricing";
import { PlanComparison } from "../../components/pricing-table";
import { Streams } from "../../components/streams";
import { FinalCta, Footer } from "../../components/closing";
import { PageHero } from "../../components/page-hero";
import { Reveal } from "../../components/reveal";
import { PLANS, PRICING_FAQS } from "../../lib/plans";

export const metadata: Metadata = pageMeta({
  title: "Pricing",
  description:
    "Beginner is free: 5,000 emails, 3 projects, 2 domains. Pro is $15 or ₦25,000 for 50,000 emails and production environments. Premium is $49 or ₦75,000 for 250,000. Naira and dollar prices are separate decisions, not conversions.",
  path: "/pricing",
});

/** What happens at the limit, answered before anyone has to ask. */
const LIMITS = [
  {
    title: "No surprise overages",
    body: "When you reach your quota, sending pauses and the API tells you exactly why. You'll see your limit, current usage, and reset time.",
  },
  {
    title: "Retries don't become extra charges",
    body: "Calder handles provider retries, idempotent requests, and webhook redelivery without turning infrastructure behavior into another line on your bill.",
  },
  {
    title: "Test before you send",
    body: "Test keys let you exercise the API, queue, events, webhooks, and delivery pipeline without sending real mail or consuming your monthly quota.",
  },
];

export default function PricingPage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(pricingJsonLd(PLANS)) }}
      />
      <Navigation />
      <main>
        <PageHero
          eyebrow="Pricing"
          title="Infrastructure that starts free."
          lede={
            <>
              Build, ship, and grow without paying before you need to. Every Calder plan includes
              the core infrastructure for sending, tracking, and understanding application
              communication.
              <br /><br />
              <strong>5,000 emails every month at ₦0.</strong> No credit card. No trial clock. No surprise overages.
            </>
          }
        />
        <div style={{ paddingBottom: "2rem" }}>
          <Pricing />
        </div>

        <section className="section" style={{ paddingTop: 0 }}>
          <div className="wrap">
            <Reveal>
              <p className="eyebrow">At the limit</p>
              <h2 className="h2">
                Your quota is a <em>boundary, not a trap.</em>
              </h2>
              <p className="lede" style={{ marginTop: "1rem" }}>
                We don&rsquo;t believe a pricing page should require a calculator. When you reach
                your plan&rsquo;s limit, Calder doesn&rsquo;t quietly start charging you.
              </p>
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

        <Streams />

        <PlanComparison />

        <section className="section" style={{ paddingTop: 0 }}>
          <div className="wrap">
            <Reveal>
              <p className="eyebrow">Questions, answered plainly</p>
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
