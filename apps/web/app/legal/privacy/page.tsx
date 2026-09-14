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
              Your data, <em>and not much of it.</em>
            </>
          }
          lede="Calder holds credentials, recipient addresses and billing details, so we collect what the service needs to run and nothing more. Last updated September 2026."
        />
        <section className="section" style={{ paddingTop: 0 }}>
          <div className="wrap docs-main" style={{ maxWidth: 720 }}>
            <h2>What we collect</h2>
            <p>
              Your account details, the messages you ask us to send (recipients, content, metadata),
              the delivery events those messages produce, usage records used for metering, and
              suppression and consent records that keep opted-out addresses out of future sends.
              Billing details are handled by our payment provider. We do not sell personal data.
            </p>
            <h2>Why we keep it</h2>
            <p>
              Delivery events and message records are the product: your logs, timelines and invoices
              are built from them. Usage records support billing, and suppression records exist so a
              person who opted out stays opted out. Everything else is there to operate and secure
              the service.
            </p>
            <h2>Your rights</h2>
            <p>
              Ask support for an export or deletion at any time. Deletion removes customer data from
              production systems; aggregated, non-identifying metrics may remain. Formal
              data-processing terms are available if your legal team needs them on file.
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
