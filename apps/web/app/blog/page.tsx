import type { Metadata } from "next";
import Link from "next/link";
import { Navigation } from "../../components/navigation";
import { Footer } from "../../components/closing";
import { PageHero } from "../../components/page-hero";
import { Reveal } from "../../components/reveal";

export const metadata: Metadata = {
  title: "Blog — Avenor",
  description: "Notes on transactional email, deliverability, and building infrastructure.",
};

export default function BlogIndex() {
  return (
    <>
      <Navigation />
      <main>
        <PageHero
          eyebrow="Blog"
          title={
            <>
              Notes from <em>the infrastructure.</em>
            </>
          }
          lede="Occasional, substantive, zero growth-hackery. We write when we've learned something worth your time."
        />
        <section className="section" style={{ paddingTop: 0 }}>
          <div className="wrap">
            <Reveal>
              <Link href="/blog/hello-avenor" style={{ textDecoration: "none", display: "block" }}>
                <div className="pipeline">
                  <p className="eyebrow">September 2026 · 4 min</p>
                  <h2 className="h2" style={{ fontSize: "clamp(1.5rem, 3vw, 2.2rem)" }}>
                    Hello, Avenor: why transactional email deserves its own company
                  </h2>
                  <p className="lede" style={{ marginTop: "1rem", fontSize: "1.05rem" }}>
                    Sending an email is easy. Knowing it arrived is the whole business — and why we
                    said no to newsletters, yes to idempotency, and maybe to naira pricing.
                  </p>
                  <span className="btn btn-secondary btn-sm" style={{ marginTop: "1.2rem" }}>
                    Read the post{" "}
                    <span className="arrow" aria-hidden="true">
                      →
                    </span>
                  </span>
                </div>
              </Link>
            </Reveal>
            <Reveal delay={120}>
              <div
                style={{
                  marginTop: "4rem",
                  textAlign: "center",
                  borderTop: "1px solid var(--border)",
                  paddingTop: "3rem",
                }}
              >
                <p className="eyebrow" style={{ justifyContent: "center" }}>
                  Join the conversation
                </p>
                <h2 className="h2">
                  Stay on the <em>record.</em>
                </h2>
                <p className="lede" style={{ margin: "1rem auto 2rem" }}>
                  We're onboarding early-access users in position order. Get your ticket now to be
                  among the first to shape the platform.
                </p>
                <a className="btn btn-primary" href="/waitlist">
                  Join the waitlist{" "}
                  <span className="arrow" aria-hidden="true">
                    →
                  </span>
                </a>
              </div>
            </Reveal>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
