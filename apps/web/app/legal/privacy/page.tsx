import type { Metadata } from "next";
import { Navigation } from "../../../components/navigation";
import { Footer } from "../../../components/closing";
import { PageHero } from "../../../components/page-hero";

export const metadata: Metadata = {
  alternates: { canonical: "https://calder.click/legal/privacy" },
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
          lede="Calder holds credentials, recipient addresses and billing details, so we collect what the service needs to run and nothing more. Last updated October 2026."
        />
        <section className="section" style={{ paddingTop: 0 }}>
          <div className="wrap docs-main" style={{ maxWidth: 720 }}>
            <h2>What we collect</h2>
            <p>
              Your account details, the messages you ask us to send (recipients, content, metadata),
              the delivery events those messages produce, usage records used for metering, and
              suppression and consent records that keep opted-out addresses out of future sends. If
              payment features become available, any billing-data handling will be described before
              purchase. We do not sell personal data.
            </p>
            <h2>Why we keep it</h2>
            <p>
              Delivery events and message records support your logs and timelines. Usage records
              support limits and metering, and suppression records exist so a person who opted out
              stays opted out. Everything else is there to operate and secure the service.
            </p>
            <h2>Connecting a Google account</h2>
            <p>
              If you connect Gmail, Google shares your verified email address and grants Calder
              permission to send messages on your behalf. Calder stores the refresh token encrypted
              so it can send messages you request. The Gmail sending permission does not give Calder
              access to read your inbox. Message content and recipient addresses you submit are
              transmitted to Google to deliver the messages. Calder does not use Google user data to
              train AI models. You can revoke access in your Google account&rsquo;s third-party
              access settings; contact{" "}
              <a href="mailto:support@calder.click">support@calder.click</a> to request deletion of
              your stored connection and account data.
            </p>
            <p>
              Calder&rsquo;s use and transfer of information received from Google APIs will adhere
              to the{" "}
              <a href="https://developers.google.com/terms/api-services-user-data-policy">
                Google API Services User Data Policy
              </a>
              , including its Limited Use requirements. To enforce abuse limits across projects and
              reconnects, sending attempts are recorded against a hashed email address; this hash
              can still be associated with an address and is retained independently of a project.
            </p>
            <h2>Your rights</h2>
            <p>
              Ask support for an export or deletion at any time. We will explain what can be deleted
              and what must be retained for security or legal reasons, including abuse-prevention
              records. Contact <a href="mailto:support@calder.click">support@calder.click</a>.
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
