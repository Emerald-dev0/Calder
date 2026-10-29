import type { Metadata } from "next";
import Link from "next/link";
import { Navigation } from "../../components/navigation";
import { Footer } from "../../components/closing";
import { PageHero } from "../../components/page-hero";
import { Reveal } from "../../components/reveal";
import { pageMeta } from "../../lib/seo";
import { planPrice, planSummary } from "../../lib/plans";
import { SIGNUP_URL } from "../../lib/site";

/**
 * Canonical entity page: the single authoritative answer to "What is Calder?"
 * for humans and answer engines alike. Every line here is checkable elsewhere
 * on this site or in the docs, no claim that needs a marketing department to
 * defend.
 */
export const metadata: Metadata = pageMeta({
  title: "What is Calder",
  description:
    "Calder is communication infrastructure for applications: transactional email, and a separate marketing stream, through an API, observable from queued to delivered. Free for 5,000 emails a month.",
  path: "/what-is-calder",
});

const FACTS: Array<[string, string]> = [
  ["What", "Communication infrastructure for applications. Email is the first primitive."],
  [
    "Does",
    "Transactional mail: verification codes, password resets, receipts, invoices, security alerts, order updates. Through a versioned REST API.",
  ],
  [
    "Also does",
    "Marketing mail on a separate stream: newsletters, launches, promotions, lifecycle campaigns, with their own audiences, consent, suppression and contact limits. In development, included in every plan when it ships.",
  ],
  [
    "How",
    "Validate → persist → queue → worker → provider, with idempotency keys, retries with backoff, suppression checks before every send, and signed webhooks for every event.",
  ],
  [
    "Pricing",
    `Beginner is free: ${planSummary("beginner")}. Pro is ${planPrice("pro", "USD")} or ${planPrice("pro", "NGN")} for 50,000. Premium is ${planPrice("premium", "USD")} or ${planPrice("premium", "NGN")} for 250,000. These are planned prices; paid checkout is not available yet. Naira and dollar prices are set separately, not converted.`,
  ],
  [
    "Evidence",
    "Every response carries a request ID. Every email carries a timeline from queued to delivered, bounced or failed. Logs are retained 7 to 90 days depending on plan.",
  ],
  ["Where", "Nigeria-first, with planned local pricing and the same API for developers elsewhere."],
  [
    "Status",
    "Availability depends on production configuration. See the availability and status pages for current information.",
  ],
];

export default function WhatIsCalder() {
  return (
    <>
      <Navigation />
      <main>
        <PageHero
          eyebrow="Entity"
          title={
            <>
              Calder is email infrastructure <em>for applications.</em>
            </>
          }
          lede="One endpoint in, delivery events out, and a record you can show someone. If you arrived here from a search engine or an AI answer, this page is the summary: everything below is verifiable elsewhere on this site."
        />
        <section className="section" style={{ paddingTop: 0 }}>
          <div className="wrap">
            <Reveal>
              <table className="docs-table">
                <tbody>
                  {FACTS.map(([k, v]) => (
                    <tr key={k}>
                      <td>
                        <b style={{ color: "var(--ink)" }}>{k}</b>
                      </td>
                      <td>{v}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Reveal>
            <Reveal delay={100}>
              <div style={{ display: "flex", gap: "0.8rem", flexWrap: "wrap", marginTop: "2rem" }}>
                <Link className="btn btn-primary" href={SIGNUP_URL}>
                  Start free{" "}
                  <span className="arrow" aria-hidden="true">
                    →
                  </span>
                </Link>
                <Link className="btn btn-secondary" href="/docs">
                  Read the docs
                </Link>
                <Link className="btn btn-secondary" href="/pricing">
                  See pricing
                </Link>
              </div>
            </Reveal>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
