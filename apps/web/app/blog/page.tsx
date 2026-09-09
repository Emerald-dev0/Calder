import type { Metadata } from "next";
import Link from "next/link";
import { pageMeta } from "../../lib/seo";
import { Navigation } from "../../components/navigation";
import { Footer } from "../../components/closing";
import { PageHero } from "../../components/page-hero";
import { Reveal } from "../../components/reveal";
import { POSTS } from "./posts";

export const metadata: Metadata = pageMeta({
  title: "Blog",
  description: "Notes on transactional email, deliverability, and building infrastructure.",
  path: "/blog",
});

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
            {POSTS.map((post, i) => (
              <Reveal key={post.slug} delay={i === 0 ? 0 : 120}>
                <Link
                  href={`/blog/${post.slug}`}
                  style={{ textDecoration: "none", display: "block", marginBottom: "1.5rem" }}
                >
                  <div className="pipeline">
                    <p className="eyebrow">
                      {post.date} · {post.readTime}
                    </p>
                    <h2 className="h2" style={{ fontSize: "clamp(1.5rem, 3vw, 2.2rem)" }}>
                      {post.title}
                    </h2>
                    <p className="lede" style={{ marginTop: "1rem", fontSize: "1.05rem" }}>
                      {post.excerpt}
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
            ))}
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
