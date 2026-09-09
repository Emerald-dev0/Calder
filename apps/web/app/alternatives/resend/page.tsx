import type { Metadata } from "next";
import Link from "next/link";
import { Navigation } from "../../../components/navigation";
import { Footer } from "../../../components/closing";
import { PageHero } from "../../../components/page-hero";
import { Reveal } from "../../../components/reveal";
import { pageMeta } from "../../../lib/seo";

export const metadata: Metadata = pageMeta({
  title: "Calder vs Resend",
  description:
    "Honest comparison: Resend vs Calder on email API, SMTP, pricing in NGN and USD, idempotency, webhooks, and who each is for.",
  path: "/alternatives/resend",
});

const ROWS: Array<[string, string, string]> = [
  ["Email API", "REST, SDKs, SMTP relay", "REST, SDKs, SMTP relay"],
  ["Free tier", "3,000/mo + 100/day cap", "3,000/mo, 500/day abuse-guard ceiling"],
  ["Paid entry", "$20/mo · 50,000 emails", "≈₦3,500/mo · ~25,000 emails (hypothesis)"],
  ["Currencies", "USD", "NGN-first, USD to follow"],
  ["Idempotency keys", "No first-class story", "Durable keys, billed once, 24h replay"],
  ["Failed-send visibility", "Logs", "Dead-letter with reason, attempts, replay"],
  ["Webhooks", "Granular events", "Signed, retried, attempt history, replay"],
  ["Broadcasts/audiences", "Full marketing suite", "Not offered — transactional only, by design"],
  ["React templates", "react-email, first-class", "Any HTML today; versioned templates soon"],
  [
    "Start without a domain",
    "Requires domain verification",
    "Gmail Quickstart — OAuth, capped, honest limits",
  ],
];

export default function ResendAlternative() {
  return (
    <>
      <Navigation />
      <main>
        <PageHero
          eyebrow="Resend alternative"
          title={
            <>
              Calder vs Resend, <em>stated fairly.</em>
            </>
          }
          lede="Resend is a good product built by a good team — this page exists so you can decide with facts, not marketing. Figures checked September 2026; tell us if anything drifted."
        />
        <section className="section" style={{ paddingTop: 0 }}>
          <div className="wrap">
            <Reveal>
              <table className="docs-table">
                <thead>
                  <tr>
                    <th>Concern</th>
                    <th>Resend</th>
                    <th>Calder</th>
                  </tr>
                </thead>
                <tbody>
                  {ROWS.map(([c, r, a]) => (
                    <tr key={c}>
                      <td>
                        <b style={{ color: "var(--ink)" }}>{c}</b>
                      </td>
                      <td>{r}</td>
                      <td>{a}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Reveal>
            <div className="ed-row">
              <Reveal className="ed-copy">
                <div className="ed-index">When Resend wins</div>
                <h3>Be honest about it</h3>
                <p>
                  You need broadcasts and audiences today. You want react-email as a first-class
                  primitive. You value a five-year track record over a purpose-built newcomer. Those
                  are good reasons — pick Resend with our blessing.
                </p>
              </Reveal>
              <Reveal className="ed-copy">
                <div className="ed-index">When Calder wins</div>
                <h3>And when we do</h3>
                <p>
                  You pay in naira. You retry without fear because idempotency is structural, not
                  hoped-for. You start with Gmail and graduate to a domain without rewriting. Your
                  busy days aren&rsquo;t capped at 100 sends. Read the{" "}
                  <Link href="/docs/migrate-resend">migration guide</Link> when you&rsquo;re ready —
                  an afternoon&rsquo;s work.
                </p>
              </Reveal>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
