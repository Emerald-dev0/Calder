import type { Metadata } from "next";
import { Navigation } from "../../components/navigation";
import { FinalCta, Footer } from "../../components/closing";
import { PageHero } from "../../components/page-hero";
import { DomainScene } from "../../components/product-scenes";
import { CodeBlock } from "../../components/code";
import { Reveal } from "../../components/reveal";

export const metadata: Metadata = {
  title: "Domains — Calder",
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
          lede="Verify ownership with DNS, authenticate with SPF, DKIM, and DMARC, and watch per-domain health — bounce rate, complaint rate, verification state — without a second tool."
        />
        <section className="section" style={{ paddingTop: 0 }}>
          <div className="wrap">
            <div className="ed-row">
              <Reveal className="ed-copy">
                <div className="ed-index">Verification</div>
                <h3>Three records, then you&rsquo;re a real sender</h3>
                <p>
                  Add your domain and we hand you exact DNS records — no guessing at selectors or
                  syntax. We check them continuously, not just once, so a regression pages you
                  instead of quietly tanking delivery.
                </p>
                <ul className="ed-list">
                  <li>SPF, DKIM, and DMARC with copy-paste values</li>
                  <li>Continuous re-verification with change alerts</li>
                  <li>Stuck verifications explain what&rsquo;s wrong, specifically</li>
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
                  Addresses that bounced or complained are blocked before sending — with the reason
                  logged, visible, and reversible. No silent drops, no mystery non-deliveries, no
                  accidental re-sends to people who opted out.
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
                  <span className="tok-str">&quot;suppressed&quot;</span>,{"\n"}
                  &nbsp;&nbsp;&nbsp;&nbsp;<span className="tok-key">&quot;message&quot;</span>:{" "}
                  <span className="tok-str">
                    &quot;Recipient bounced on 12 Mar — see event ev_…&quot;
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
