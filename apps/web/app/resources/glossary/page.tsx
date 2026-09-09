import type { Metadata } from "next";
import Link from "next/link";
import { Navigation } from "../../../components/navigation";
import { Footer } from "../../../components/closing";
import { PageHero } from "../../../components/page-hero";
import { Reveal } from "../../../components/reveal";
import { pageMeta } from "../../../lib/seo";
import { TERMS } from "./terms";

export const metadata: Metadata = pageMeta({
  title: "Email Glossary",
  description:
    "Plain-language definitions for email API, SMTP, deliverability, webhooks, bounces, and the other terms infrastructure runs on.",
  path: "/resources/glossary",
});

export default function GlossaryIndex() {
  return (
    <>
      <Navigation />
      <main>
        <PageHero
          eyebrow="Glossary"
          title={
            <>
              The words email <em>runs on.</em>
            </>
          }
          lede="Short, opinionated definitions — each one paired with where Calder implements it. No filler entries."
        />
        <section className="section" style={{ paddingTop: 0 }}>
          <div className="wrap">
            <div className="docs-cards">
              {TERMS.map((t) => (
                <Link key={t.slug} href={`/resources/glossary/${t.slug}`} className="docs-card">
                  <span className="docs-card-icon">§</span>
                  <b>{t.term}</b>
                  <span>{t.short}</span>
                </Link>
              ))}
            </div>
            <Reveal>
              <p className="caption" style={{ textAlign: "center" }}>
                New terms are added only when we have something original to say about them.
              </p>
            </Reveal>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
