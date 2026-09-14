import type { Metadata } from "next";
import { Navigation } from "../../../components/navigation";
import { Footer } from "../../../components/closing";
import { PageHero } from "../../../components/page-hero";

export const metadata: Metadata = {
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
          lede="The short version: use Calder for lawful transactional email, pay for what you use, and we'll hold up our end on delivery and transparency. Last updated September 2026."
        />
        <section className="section" style={{ paddingTop: 0 }}>
          <div className="wrap docs-main" style={{ maxWidth: 720 }}>
            <h2>Acceptable use</h2>
            <p>
              Transactional email only, messages your users triggered or explicitly requested. No
              purchased lists, no bulk marketing, no spam. Accounts with sustained high bounce or
              complaint rates are throttled, then suspended, to protect every other sender on the
              platform.
            </p>
            <h2>Plans and billing</h2>
            <p>
              Quotas are hard limits, not overage traps: when you hit yours, sends pause with a
              clear error until you upgrade or the cycle resets. Usage is metered from durable
              records, if an invoice ever disagrees with your dashboard, the invoice is wrong and
              we'll fix it.
            </p>
            <h2>Uptime and liability</h2>
            <p>
              We architect for reliability, async delivery, retries, provider abstraction, and
              publish our record on the status page. That said, email traverses systems we don't
              control; our liability is limited to the fees paid in the affected period.
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
