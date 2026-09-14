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
    "Beginner ₦0/5k + 3 projects, Pro ₦15k/50k, Premium ₦45k/250k, Scale custom. Included + overage, NGN locally intentional, metered from durable records.",
  path: "/pricing",
});

const FAQS = [
  {
    q: "What counts as an email?",
    a: "One accepted send request (202 from POST /v1/emails). Webhook deliveries, event reads, and API calls are never metered.",
  },
  {
    q: "What happens when I hit my limit?",
    a: "Beginner pauses at 5k with PLAN_LIMIT_REACHED (limit/used/reset_at). Pro/Premium include 50k/250k then controlled overage per 1k — never silent charges, set a usage limit in Usage.",
  },
  {
    q: "Why both NGN and USD?",
    a: "NGN is locally intentional (₦0/₦15k/₦45k), USD globally ($0/$20/$60). Same quotas, intentional local pricing — a real advantage for Nigerian startups.",
  },
  {
    q: "Is there really a free tier?",
    a: "Beginner: 5k/mo, 3 projects, 2 domains, 5 senders, 10 templates, API/SMTP/SDK, 7-day logs, 2 webhooks — honest infrastructure, not a demo. No card, no expiry.",
  },
  {
    q: "Do test sends count against my quota?",
    a: "No. Test keys simulate the full pipeline without delivering mail and are never metered.",
  },
  {
    q: "What unlocks on Pro vs Premium?",
    a: "Pro (default): Inbox, Analytics, 5 team, 30-day logs, 10 webhooks. Premium: Audit Logs, dedicated controls, 90-day logs, 15 team, deliverability insights. See the dashboard — locked features show preview, not empty.",
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
