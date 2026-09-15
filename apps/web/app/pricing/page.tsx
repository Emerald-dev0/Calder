import type { Metadata } from "next";
import { pageMeta, pricingJsonLd } from "../../lib/seo";
import { Navigation } from "../../components/navigation";
import { Pricing } from "../../components/pricing";
import { PlanComparison } from "../../components/pricing-table";
import { Footer } from "../../components/closing";
import { PageHero } from "../../components/page-hero";
import { Reveal } from "../../components/reveal";
import { PLANS, PRICING_FAQS } from "../../lib/plans";

export const metadata: Metadata = pageMeta({
  title: "Pricing",
  description:
    "Beginner is free: 5,000 emails, 3 projects, 2 domains. Pro is $15 or ₦25,000 for 50,000 emails and production environments. Premium is $49 or ₦75,000 for 250,000. Naira and dollar prices are separate decisions, not conversions.",
  path: "/pricing",
});

/** Your quota is a boundary, not a trap. */
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

const TRANSACTIONAL_KINDS = [
  "Verification codes",
  "Password resets",
  "Receipts",
  "Invoices",
  "Security alerts",
  "Order updates",
  "Account notifications",
];

const MARKETING_KINDS = [
  "Newsletters",
  "Announcements",
  "Product launches",
  "Promotions",
  "Re-engagement",
  "Lifecycle communication",
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
          title={
            <>
              Infrastructure <em>that starts free.</em>
            </>
          }
          lede="Build, ship, and grow without paying before you need to. Every Calder plan includes the core infrastructure for sending, tracking, and understanding application communication. 5,000 emails every month at ₦0. No credit card. No trial clock. No surprise overages."
        />
        <div style={{ paddingBottom: "2rem" }}>
          <Pricing />
        </div>

        <section className="section" style={{ paddingTop: 0 }}>
          <div className="wrap">
            <Reveal>
              <p className="eyebrow">One platform</p>
              <h2 className="h2">
                Different kinds of <em>communication.</em>
              </h2>
              <p className="lede" style={{ marginTop: "1.2rem" }}>
                Your application sends messages because something happened. Your team sends messages
                because you have something to say. Calder is designed to support both without
                treating them as the same workload.
              </p>
            </Reveal>
            <div className="limit-grid">
              <Reveal>
                <div className="limit-item">
                  <h3>Transactional</h3>
                  <p>
                    Communication triggered by your application. Fast, event-driven, and built
                    around delivery reliability.
                  </p>
                  <div
                    style={{ marginTop: "1rem", display: "flex", flexWrap: "wrap", gap: "0.5rem" }}
                  >
                    {TRANSACTIONAL_KINDS.map((k) => (
                      <span className="event-pill" key={k}>
                        {k}
                      </span>
                    ))}
                  </div>
                </div>
              </Reveal>
              <Reveal delay={80}>
                <div className="limit-item">
                  <h3>Marketing</h3>
                  <p>
                    Communication sent to audiences. Audiences, consent, scheduling, automation, and
                    campaign analytics.
                  </p>
                  <div
                    style={{ marginTop: "1rem", display: "flex", flexWrap: "wrap", gap: "0.5rem" }}
                  >
                    {MARKETING_KINDS.map((k) => (
                      <span className="event-pill" key={k}>
                        {k}
                      </span>
                    ))}
                  </div>
                </div>
              </Reveal>
            </div>
            <Reveal delay={60}>
              <p className="lede" style={{ marginTop: "2rem" }}>
                Two streams. One platform. Different operational requirements underneath, the same
                Calder workspace, event history, APIs, and usage visibility around them.
              </p>
            </Reveal>
          </div>
        </section>

        <section className="section" style={{ paddingTop: 0 }}>
          <div className="wrap">
            <Reveal>
              <p className="eyebrow">At the limit</p>
              <h2 className="h2">
                Your quota is a boundary, <em>not a trap.</em>
              </h2>
              <p className="lede" style={{ marginTop: "1.2rem" }}>
                We don&apos;t believe a pricing page should require a calculator.
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

        <PlanComparison />

        <section className="section" style={{ paddingTop: 0 }}>
          <div className="wrap">
            <Reveal>
              <p className="eyebrow">Questions, answered</p>
              <h2 className="h2">
                Questions, <em>answered plainly.</em>
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

        <section className="section" style={{ paddingTop: 0 }}>
          <div className="wrap">
            <Reveal>
              <div className="final-cta">
                <p className="eyebrow" style={{ color: "#8FB0FF" }}>
                  Try it now
                </p>
                <h2>
                  You don&apos;t need to commit <em>to try it.</em>
                </h2>
                <p>
                  5,000 emails. ₦0. Join the waitlist, and see the entire delivery lifecycle for
                  yourself when your invite lands. No credit card. No sales call. No trial
                  countdown.
                </p>
                <div className="final-ctas">
                  <a className="btn btn-paper" href="/waitlist">
                    Join the waitlist{" "}
                    <span className="arrow" aria-hidden="true">
                      →
                    </span>
                  </a>
                  <a className="btn btn-outline-paper" href="/docs/quickstart">
                    Read the quickstart
                  </a>
                </div>
              </div>
            </Reveal>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
