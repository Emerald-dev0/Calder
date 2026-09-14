import type { Metadata } from "next";
import { Navigation } from "../../components/navigation";
import { FinalCta, Footer } from "../../components/closing";
import { PageHero } from "../../components/page-hero";
import { Reveal } from "../../components/reveal";

export const metadata: Metadata = {
  title: "Security, Calder",
  description:
    "How Calder protects your data: hashed keys, tenant isolation at the data layer, signed webhooks, and an honest view of certification status.",
};

const PRACTICES = [
  [
    "API keys hashed at rest",
    "Stored as SHA-256 digests and compared in constant time. We can show you a prefix and revoke a key; we never see the key itself.",
  ],
  [
    "Tenant isolation at the data layer",
    "Each query is scoped to an organization and project where it runs, not only at the route that authenticated the request.",
  ],
  [
    "Signed webhooks, verified inbound",
    "Everything we send to your endpoint carries an HMAC signature, and everything we accept from a provider is checked the same way.",
  ],
  [
    "Secrets stay server-side",
    "Tokens, signing secrets and provider credentials never reach a browser, a log line, or an error response.",
  ],
  ["Predictable errors", "Every response carries a request ID. None of them carry a stack trace."],
  [
    "Dependency hygiene",
    "The lockfile is pinned in the repository and reviewed in CI, so a transitive dependency cannot change under us unnoticed.",
  ],
] as const;

export default function SecurityPage() {
  return (
    <>
      <Navigation />
      <main>
        <PageHero
          eyebrow="Security"
          title={
            <>
              Paranoia, <em>documented.</em>
            </>
          }
          lede="Calder holds API keys, email addresses and billing data, so all of it is treated as sensitive by default. Here is what that means concretely, and where we stand on formal certification."
        />
        <section className="section" style={{ paddingTop: 0 }}>
          <div className="wrap">
            <div style={{ marginTop: "1rem" }}>
              {PRACTICES.map(([title, body], i) => (
                <div className="ed-row" key={title} style={{ padding: "1.8rem 0" }}>
                  <Reveal>
                    <div className="ed-index">0{i + 1}</div>
                    <h3 style={{ margin: 0, fontSize: "1.3rem", letterSpacing: "-0.015em" }}>
                      {title}
                    </h3>
                  </Reveal>
                  <Reveal delay={80}>
                    <p style={{ margin: 0, color: "var(--ink-soft)" }}>{body}</p>
                  </Reveal>
                </div>
              ))}
            </div>
            <Reveal>
              <div className="pipeline" style={{ marginTop: "2.5rem" }}>
                <p className="eyebrow">Certifications, honestly</p>
                <div className="minilog">
                  <div className="minilog-row">
                    <span className="status-dot warn" />
                    <span className="addr">
                      <b>SOC 2</b>, not certified. The controls are designed with it in mind, and
                      the audit is scheduled before enterprise launch.
                    </span>
                    <span className="tag warn">roadmap</span>
                  </div>
                  <div className="minilog-row">
                    <span className="status-dot warn" />
                    <span className="addr">
                      <b>GDPR</b>, data minimization and deletion are built into the schema; a
                      formal DPA is available on request.
                    </span>
                    <span className="tag warn">roadmap</span>
                  </div>
                  <div className="minilog-row">
                    <span className="status-dot ok" />
                    <span className="addr">
                      <b>Transport</b>, TLS everywhere, HSTS and strict security headers on every
                      surface.
                    </span>
                    <span className="tag ok">live</span>
                  </div>
                </div>
                <p className="caption" style={{ marginTop: "1rem" }}>
                  A roadmap is worth more than a badge we have not earned. If a procurement team
                  needs specific answers, write to security@calder.click and you will get them in
                  writing.
                </p>
              </div>
            </Reveal>
          </div>
        </section>
        <FinalCta />
      </main>
      <Footer />
    </>
  );
}
