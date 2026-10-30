import type { Metadata } from "next";
import { Navigation } from "../../../components/navigation";
import { Footer } from "../../../components/closing";
import { PageHero } from "../../../components/page-hero";

export const metadata: Metadata = {
  alternates: { canonical: "https://calder.click/legal/terms" },
  title: "Terms of Service, Calder",
  description: "The terms governing your use of Calder.",
};

export default function TermsPage() {
  return (
    <>
      <Navigation />
      <main>
        <PageHero
          eyebrow="Legal · Terms"
          title={
            <>
              Fair terms, <em>plainly stated.</em>
            </>
          }
          lede="The short version: send mail people asked for, respect sending limits, and use Calder responsibly. Last updated October 2026."
        />
        <section className="section" style={{ paddingTop: 0 }}>
          <div className="wrap docs-main" style={{ maxWidth: 720 }}>
            <h2>Acceptable use</h2>
            <p>
              Calder carries two kinds of mail, and each has its own rules. Transactional messages
              (receipts, password resets, notifications) must be triggered by your users&rsquo; own
              actions. Marketing messages must go only to people who opted in, must include a
              working unsubscribe link that we honour immediately, and must respect every
              suppression record on the account.
            </p>
            <p>
              No purchased or scraped lists, no sending on someone else&rsquo;s behalf, no using one
              stream to boost the other. Calder keeps the two streams separate at the pipeline level
              precisely so campaign reputation can&rsquo;t damage password resets, and accounts with
              sustained high bounce or complaint rates are throttled before they are suspended, to
              protect every other sender on the platform.
            </p>
            <h2>Plans and billing</h2>
            <p>
              Sending and account limits apply and may change as the service develops. Gmail
              connections have a separate allowance shown in the dashboard. Paid checkout and
              upgrades are not currently promised; any future fees and payment terms will be
              communicated before purchase.
            </p>
            <h2>Uptime and liability</h2>
            <p>
              We architect for reliability, async delivery, retries, provider abstraction, and
              publish our record on the status page. That said, email traverses systems we
              don&rsquo;t control; our liability is limited to the fees paid in the affected period.
            </p>
            <h2>Changes</h2>
            <p>
              Material changes to these terms come with notice and a changelog entry. Continued use
              after changes take effect constitutes acceptance.
            </p>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
