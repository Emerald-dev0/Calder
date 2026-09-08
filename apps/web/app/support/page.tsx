import type { Metadata } from "next";
import Link from "next/link";
import { Navigation } from "../../components/navigation";
import { Footer } from "../../components/closing";
import { PageHero } from "../../components/page-hero";
import { Reveal } from "../../components/reveal";

export const metadata: Metadata = {
  title: "Support — Calder",
  description: "Get help with Calder: docs, status, and how to reach a human.",
};

const TOPICS: Array<{ title: string; body: string; href: string }> = [
  {
    title: "\u201cI never got the email\u201d",
    body: "Check the email's timeline in your dashboard first \u2014 queued, sent, delivered, bounced. Nine times out of ten the answer is there with a timestamp.",
    href: "/docs/concepts",
  },
  {
    title: "API errors",
    body: "Every error carries a request_id. Search the API reference for the code, then quote the ID if you write in.",
    href: "/docs/api-reference",
  },
  {
    title: "Domain verification stuck?",
    body: "DNS propagates slowly and fails silently. The deliverability guide walks through the usual suspects.",
    href: "/docs/deliverability",
  },
  {
    title: "Billing questions",
    body: "Usage is metered from the same records you see in the dashboard. If an invoice ever disagrees with them, that's our bug \u2014 tell us.",
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
          lede="Most answers are already written down. For everything else, a human reads every message — usually the person who built the thing you're asking about."
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
                  Write to <b className="mono">support@calder.com</b> with your{" "}
                  <span className="mono">request_id</span> or email id. Migrations from other
                  providers get white-glove help — see{" "}
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
                  first during an active incident — that's where we post timelines.
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
