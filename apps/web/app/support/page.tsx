import type { Metadata } from "next";
import Link from "next/link";
import { Navigation } from "../../components/navigation";
import { Footer } from "../../components/closing";
import { PageHero } from "../../components/page-hero";
import { Reveal } from "../../components/reveal";

export const metadata: Metadata = {
  title: "Support, Calder",
  description: "Get help with Calder: docs, status, and how to reach a human.",
};

const TOPICS: Array<{ title: string; body: string; href: string }> = [
  {
    title: "\u201cI never got the email\u201d",
    body: "Open the email in your dashboard and read its timeline: queued, sent, delivered, bounced, with a timestamp on each step. Most of the time the answer is already there.",
    href: "/docs/concepts",
  },
  {
    title: "API errors",
    body: "Every error carries a request_id and a machine-readable code. Look the code up in the API reference; if you still need us, send the request_id and we can read the exact call.",
    href: "/docs/api-reference",
  },
  {
    title: "Domain verification stuck?",
    body: "DNS propagates slowly and fails quietly. The deliverability guide covers the three records, the common typos, and what each failure message actually means.",
    href: "/docs/deliverability",
  },
  {
    title: "Billing questions",
    body: "Usage is metered from the same records your dashboard shows, never a separate counter. If an invoice ever disagrees with what you saw, that is our bug: tell us and we will fix it.",
    href: "/pricing",
  },
];

export default function SupportPage() {
  return (
    <>
      <Navigation />
      <main>
        <PageHero
          eyebrow="Support"
          title={
            <>
              Stuck? <em>Start here.</em>
            </>
          }
          lede="Most answers are already written down, and the docs are short on purpose. For everything else, a human reads every message, usually the person who built the part you are asking about."
        />
        <section className="section" style={{ paddingTop: 0 }}>
          <div className="wrap">
            <div style={{ marginTop: "1rem" }}>
              {TOPICS.map(({ title, body, href }, i) => (
                <div className="ed-row" key={title} style={{ padding: "1.6rem 0" }}>
                  <Reveal>
                    <div className="ed-index">0{i + 1}</div>
                    <h3 style={{ margin: 0, fontSize: "1.2rem", letterSpacing: "-0.01em" }}>
                      {title}
                    </h3>
                  </Reveal>
                  <Reveal delay={80}>
                    <p style={{ margin: "0 0 0.8rem", color: "var(--ink-soft)" }}>{body}</p>
                    <Link
                      href={href}
                      style={{ color: "var(--accent)", fontWeight: 600, fontSize: "0.92rem" }}
                    >
                      Read more <span aria-hidden="true">→</span>
                    </Link>
                  </Reveal>
                </div>
              ))}
            </div>
            <Reveal>
              <div className="pipeline" style={{ marginTop: "2rem" }}>
                <p className="eyebrow">Still stuck</p>
                <p className="lede" style={{ fontSize: "1.05rem" }}>
                  Write to <b className="mono">support@calder.click</b> with your{" "}
                  <span className="mono">request_id</span> or email id. Migrations from other
                  providers get white-glove help, see{" "}
                  <Link href="/migrate" style={{ color: "var(--accent)" }}>
                    the migration guide
                  </Link>
                  .
                </p>
                <p className="caption" style={{ marginTop: "0.8rem" }}>
                  Check{" "}
                  <Link href="/status" style={{ color: "var(--accent)" }}>
                    status
                  </Link>{" "}
                  first during an active incident, that's where we post timelines.
                </p>
              </div>
            </Reveal>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
