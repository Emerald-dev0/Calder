import type { Metadata } from "next";
import { Navigation } from "../../components/navigation";
import { FinalCta, Footer } from "../../components/closing";
import { PageHero } from "../../components/page-hero";
import { DomainScene } from "../../components/product-scenes";
import { CodeBlock } from "../../components/code";
import { Reveal } from "../../components/reveal";

export const metadata: Metadata = {
  title: "Domains, Calder",
  description:
    "Verify sending domains with DNS, protect your reputation with SPF, DKIM, and DMARC, and monitor domain health.",
};

export default function DomainsPage() {
  return (
    <>
      <Navigation />
      <main>
        <PageHero
          eyebrow="Domains & deliverability"
          title={
            <>
              Your name on every send, <em>your reputation intact.</em>
            </>
          }
          lede="Verify ownership with DNS, authenticate with SPF, DKIM, and DMARC, and watch verification state per domain. Bounce and complaint rates come from provider feedback that is being wired in now."
        />
        <section className="section" style={{ paddingTop: 0 }}>
          <div className="wrap">
            <div className="ed-row">
              <Reveal className="ed-copy">
                <div className="ed-index">Verification</div>
                <h3>Three records, then you&rsquo;re a real sender</h3>
                <p>
                  Add the domain and Calder prints the exact records to paste, DKIM selector
                  included, so there is nothing to guess. Verification runs on a schedule rather
                  than once, so a record someone deletes in March shows up as a failing check
                  instead of a silent drop in delivery.
                </p>
                <ul className="ed-list">
                  <li>SPF, DKIM and DMARC records with copy-paste values</li>
                  <li>Re-verification on a schedule, with the failing record identified</li>
                  <li>Suppression checked before every send, automatically</li>
                </ul>
              </Reveal>
              <Reveal delay={120} className="ed-visual">
                <DomainScene />
              </Reveal>
            </div>
            <div className="ed-row flip">
              <Reveal className="ed-copy">
                <div className="ed-index">Protection</div>
                <h3>Suppression with a paper trail</h3>
                <p>
                  Addresses that bounced or complained are recorded once and refused before any
                  future send, with the reason attached. The list is visible in the dashboard, and a
                  blocked send returns an error naming the reason instead of quietly doing nothing.
                </p>
                <ul className="ed-list">
                  <li>Checked before every send, automatically</li>
                  <li>Blocked sends return a reason, not silence</li>
                  <li>Manual entries for compliance and caution alike</li>
                </ul>
              </Reveal>
              <Reveal delay={120}>
                <CodeBlock title="suppressed, with a reason">
                  <span className="tok-punct">{"{"}</span>
                  {"\n"}
                  &nbsp;&nbsp;<span className="tok-key">&quot;error&quot;</span>:{" "}
                  <span className="tok-punct">{"{"}</span>
                  {"\n"}
                  &nbsp;&nbsp;&nbsp;&nbsp;<span className="tok-key">&quot;code&quot;</span>:{" "}
                  <span className="tok-str">&quot;suppressed&quot;</span>, {"\n"}
                  &nbsp;&nbsp;&nbsp;&nbsp;<span className="tok-key">&quot;message&quot;</span>:{" "}
                  <span className="tok-str">
                    &quot;Recipient bounced on 12 Mar, see event ev_…&quot;
                  </span>
                  {"\n"}
                  &nbsp;&nbsp;<span className="tok-punct">{"}"}</span>
                  {"\n"}
                  <span className="tok-punct">{"}"}</span>{" "}
                  <span className="tok-dim">{"// a no you can act on"}</span>
                </CodeBlock>
              </Reveal>
            </div>
          </div>
        </section>
        <FinalCta />
      </main>
      <Footer />
    </>
  );
}
