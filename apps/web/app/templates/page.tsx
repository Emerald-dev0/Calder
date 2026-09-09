import type { Metadata } from "next";
import { Navigation } from "../../components/navigation";
import { FinalCta, Footer } from "../../components/closing";
import { PageHero } from "../../components/page-hero";
import { TemplateScene } from "../../components/product-scenes";
import { CodeBlock } from "../../components/code";
import { Reveal } from "../../components/reveal";

export const metadata: Metadata = {
 title: "Templates, Calder",
 description:
 "Versioned email templates with variables, previews, and safe publishing. In development now, send any HTML today.",
};

export default function TemplatesPage() {
 return (
 <>
 <Navigation />
 <main>
 <PageHero
 eyebrow="Templates · in development"
 title={
 <>
 Emails your designer <em>would sign off on.</em>
 </>
 }
 lede="Versioned templates with variables, previews, and one-click publishing, so 'can you tweak the receipt?' stops meaning a code deploy. We're finishing the delivery core first, then this."
 />
 <section className="section" style={{ paddingTop: 0 }}>
 <div className="wrap">
 <div className="ed-row">
 <Reveal className="ed-copy">
 <div className="ed-index">How it will work</div>
 <h3>Write once, render everywhere</h3>
 <p>
 Define a template with named variables, preview it with real sample data, then
 publish a version. Sending references the template and version, rolling back is
 one click, not one deploy.
 </p>
 <ul className="ed-list">
 <li>Variables with safe defaults, no broken {"{{ }}"} in inboxes</li>
 <li>Every version kept, every send traceable to its version</li>
 <li>Test sends to yourself before anything goes live</li>
 </ul>
 </Reveal>
 <Reveal delay={120} className="ed-visual">
 <TemplateScene />
 </Reveal>
 </div>
 <div className="ed-row flip">
 <Reveal className="ed-copy">
 <div className="ed-index">Today</div>
 <h3>Bring any HTML in the meantime</h3>
 <p>
 Templates don&rsquo;t block you. Send fully-rendered HTML today, React Email,
 MJML output, hand-rolled tables, whatever your stack produces. When templates
 land, your existing sends keep working untouched.
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
