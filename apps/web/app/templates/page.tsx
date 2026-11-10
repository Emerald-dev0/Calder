import type { Metadata } from "next";
import { Navigation } from "../../components/navigation";
import { FinalCta, Footer } from "../../components/closing";
import { PageHero } from "../../components/page-hero";
import { TemplateScene } from "../../components/product-scenes";
import { CodeBlock } from "../../components/code";
import { Reveal } from "../../components/reveal";

export const metadata: Metadata = {
  alternates: { canonical: "https://calder.click/templates" },
  title: "Templates, Calder",
  description:
    "Versioned email templates with variables, previews, immutable versions, and send-by-alias. Available now through the API and the dashboard.",
};

export default function TemplatesPage() {
  return (
    <>
      <Navigation />
      <main>
        <PageHero
          eyebrow="Templates · live"
          title={
            <>
              Emails your designer <em>would sign off on.</em>
            </>
          }
          lede="Versioned templates with variables, previews and immutable versions, so editing the copy in a receipt stops being a deploy. Send by alias through the API or from the dashboard, and see the resulting delivery in your logs."
        />
        <section className="section" style={{ paddingTop: 0 }}>
          <div className="wrap">
            <div className="ed-row">
              <Reveal className="ed-copy">
                <div className="ed-index">How it works</div>
                <h3>Write once, render everywhere</h3>
                <p>
                  Define a template with named variables, preview it against sample values, then
                  save a version. Every save appends an immutable version; API sends always resolve
                  the latest, and a missing variable is rejected instead of rendering a placeholder.
                </p>
                <ul className="ed-list">
                  <li>Missing variables fail the send with the variable names</li>
                  <li>Every version kept; the sent email stores its rendered content</li>
                  <li>Sandbox test sends from the dashboard before anything goes live</li>
                </ul>
              </Reveal>
              <Reveal delay={120} className="ed-visual">
                <TemplateScene />
              </Reveal>
            </div>
            <div className="ed-row flip">
              <Reveal className="ed-copy">
                <div className="ed-index">Optional</div>
                <h3>Or bring your own HTML</h3>
                <p>
                  Templates are not a prerequisite for anything. Send rendered HTML directly: React
                  Email, MJML output, table markup from a design tool. Both paths use the same
                  ingest, queue, delivery and event pipeline, and existing sends keep working
                  unchanged.
                </p>
              </Reveal>
              <Reveal delay={120}>
                <CodeBlock
                  title="works today, POST /v1/emails"
                  copyText={`curl https://api.calder.click/v1/emails -H "Authorization: Bearer calder_sk_live_…" -d '{"from":"app@acme.com", "to":"ada@example.com", "subject":"Receipt", "html":"<p>…</p>"}'`}
                >
                  <span className="tok-dim">$</span> <span className="tok-key">curl</span>{" "}
                  <span className="tok-path">https://api.calder.click/v1/emails</span>
                  {"\n"}
                  &nbsp;&nbsp;<span className="tok-dim">-d</span>{" "}
                  <span className="tok-str">
                    &apos;{"{"}&quot;html&quot;: &quot;&lt;p&gt;…&lt;/p&gt;&quot;{"}"}&apos;
                  </span>{" "}
                  <span className="tok-dim">{"// any HTML you like"}</span>
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
