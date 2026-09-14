import type { Metadata } from "next";
import { Navigation } from "../../components/navigation";
import { FinalCta, Footer } from "../../components/closing";
import { PageHero } from "../../components/page-hero";
import { Reveal } from "../../components/reveal";
import { pageMeta } from "../../lib/seo";

export const metadata: Metadata = pageMeta({
  title: "About",
  description:
    "Why Calder exists: sending email from an application should be one API call, not six vendors. Written and built by Daniel Oluwadare in Lagos.",
  path: "/about",
});

const PRINCIPLES: Array<[string, string]> = [
  [
    "Two streams, never mixed",
    "Application mail and campaign mail share an API and nothing else: not reputation, not suppression, not rate limits. Transactional mail is the part your product breaks without.",
  ],
  [
    "Debuggability is a feature",
    "Every operation leaves a trail you can read. If you have to ask support where your email went, we did not finish building it.",
  ],
  [
    "Boring where it counts",
    "Queues, retries, idempotency and DNS are solved problems. We spend our ambition on the parts that are genuinely unsolved, and we keep the rest predictable.",
  ],
  [
    "Honest pricing",
    "Naira and dollars as separate decisions, hard limits instead of overages, and a pricing page that marks what is still being built.",
  ],
  [
    "Design is infrastructure too",
    "A tool you use every day at 2am deserves the same care as a consumer product. Every page here is an argument for that.",
  ],
];

export default function AboutPage() {
  return (
    <>
      <Navigation />
      <main>
        <PageHero
          eyebrow="About"
          title={
            <>
              Built by one developer <em>who got tired of this.</em>
            </>
          }
          lede="Calder started with a familiar frustration: sending an email from an application should be one API call, and doing it properly means providers, DNS, queues, retries, webhooks, suppression and billing spread across six vendors. Calder is the version of that stack someone finally assembled properly, for developers who want to ship the product, not the plumbing."
        />
        <section className="section" style={{ paddingTop: 0 }}>
          <div className="wrap">
            <Reveal>
              <p className="eyebrow">How we work</p>
              <h2 className="h2">
                Five principles, <em>actually enforced.</em>
              </h2>
            </Reveal>
            <div style={{ marginTop: "1rem" }}>
              {PRINCIPLES.map(([title, body], i) => (
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

            <Reveal delay={60}>
              <div className="about-note">
                <p className="eyebrow">Who is behind it</p>
                <p>
                  Calder is built by Daniel Oluwadare, a developer in Lagos, with the infrastructure
                  bias that comes from shipping to users on connections that drop and phones that
                  cost a month&rsquo;s data. There is no sales team to get through and no support
                  tier that reaches a stranger: while Calder is small, the person who answers your
                  email is the person who wrote the retry logic. Support reaches{" "}
                  <a href="mailto:support@calder.click">support@calder.click</a>.
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
