import type { Metadata } from "next";
import { Navigation } from "../../../components/navigation";
import { Footer } from "../../../components/closing";
import { PageHero } from "../../../components/page-hero";

export const metadata: Metadata = {
  title: "Privacy Policy, Calder",
  description: "How Calder collects, uses, and protects your data.",
};

export default function PrivacyPage() {
  return (
    <>
      <Navigation />
      <main>
        <PageHero
          eyebrow="Legal · Privacy"
          title={
            <>
              Your data, <em>minimized by design.</em>
            </>
          }
          lede="We handle credentials, email addresses, and billing data, so we collect as little as possible and protect all of it. Last updated September 2026."
        />
        <section className="section" style={{ paddingTop: 0 }}>
          <div className="wrap docs-main" style={{ maxWidth: 720 }}>
            <h2>What we collect</h2>
            <p>
              Account details (name, email), sending data you submit (recipients, content,
              metadata), event and delivery records, usage metering, and billing details processed
              by our payment provider. We do not sell personal data, full stop.
            </p>
            <h2>Why we keep it</h2>
            <p>
              Event and email records power your logs, timelines, and invoices, the product itself.
              Usage records support billing. Everything else exists to operate and secure the
              service, and nothing else.
            </p>
            <h2>Your rights</h2>
            <p>
              Request export or deletion of your data at any time via support. Deletion removes
              customer data from production systems; aggregated, non-identifying metrics may remain.
              Formal data-processing terms are available for customers who need them.
            </p>
            <h2>Security</h2>
            <p>
              Encrypted transport everywhere, hashed API keys, tenant-isolated queries, signed
              webhooks. See our <a href="/security">security practices</a> for the full picture.
            </p>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
