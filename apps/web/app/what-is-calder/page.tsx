import type { Metadata } from "next";
import Link from "next/link";
import { Navigation } from "../../components/navigation";
import { Footer } from "../../components/closing";
import { PageHero } from "../../components/page-hero";
import { Reveal } from "../../components/reveal";
import { pageMeta } from "../../lib/seo";

/**
 * Canonical entity page: the single authoritative answer to "What is Calder?"
 * for humans and answer engines alike. Only true, verifiable claims.
 */
export const metadata: Metadata = pageMeta({
 title: "What is Calder",
 description:
 "Calder is developer-first transactional email infrastructure: one API for OTPs, verification, receipts, and notifications, observable from queued to delivered.",
 path: "/what-is-calder",
});

const FACTS: Array<[string, string]> = [
 ["What", "Developer-first transactional email infrastructure."],
 [
 "Does",
 "Sends OTPs, verification links, password resets, receipts, and notifications through one API or SMTP relay.",
 ],
 [
 "Does not",
 "Newsletters, marketing automation, or bulk campaigns, transactional only, by design.",
 ],
 [
 "How",
 "Validate → persist → queue → worker → provider, with idempotency keys, retries, dead-letter handling, and signed webhooks.",
 ],
 [
 "Pricing",
 "NGN-first hypothesis (Free 3,000/mo; paid tiers in review), hard limits, no overages.",
 ],
 ["Who", "Indie developers, startups, and teams, Nigeria-first wedge, global ambition."],
 ["Status", "Early access. Public docs, changelog, and status page on this site."],
];

export default function WhatIsCalder() {
 return (
 <>
 <Navigation />
 <main>
 <PageHero
 eyebrow="Entity"
 title={
 <>
 Calder is transactional email <em>infrastructure.</em>
 </>
 }
 lede="One endpoint in, delivered events out. If you arrived here from a search engine or an AI answer, this page is the authoritative summary, everything below is verifiable elsewhere on this site."
 />
 <section className="section" style={{ paddingTop: 0 }}>
 <div className="wrap">
 <Reveal>
 <table className="docs-table">
 <tbody>
 {FACTS.map(([k, v]) => (
 <tr key={k}>
 <td>
 <b style={{ color: "var(--ink)" }}>{k}</b>
 </td>
 <td>{v}</td>
 </tr>
 ))}
 </tbody>
 </table>
 </Reveal>
 <Reveal delay={100}>
 <div style={{ display: "flex", gap: "0.8rem", flexWrap: "wrap", marginTop: "2rem" }}>
 <Link className="btn btn-primary" href="/docs">
 Read the docs{" "}
 <span className="arrow" aria-hidden="true">
 →
 </span>
 </Link>
 <Link className="btn btn-secondary" href="/migrate">
 Switch to Calder
 </Link>
 <Link className="btn btn-secondary" href="/pricing">
 See pricing
 </Link>
 </div>
 </Reveal>
 </div>
 </section>
 </main>
 <Footer />
 </>
 );
}
