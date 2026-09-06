import type { Metadata } from "next";
import Link from "next/link";
import { Navigation } from "../../../components/navigation";
import { Footer } from "../../../components/closing";
import { Reveal } from "../../../components/reveal";

export const metadata: Metadata = {
  title: "Hello, Avenor — Avenor Blog",
  description: "Why transactional email deserves its own infrastructure company.",
};

export default function HelloAvenor() {
  return (
    <>
      <Navigation />
      <main>
        <section className="section">
          <div className="wrap" style={{ maxWidth: 720 }}>
            <Reveal>
              <p className="eyebrow">September 2026 · 4 min</p>
              <h1 className="display" style={{ fontSize: "clamp(2.2rem, 5vw, 3.6rem)" }}>
                Hello, Avenor: why transactional email <em>deserves its own company.</em>
              </h1>
            </Reveal>
            <Reveal delay={100}>
              <div className="docs-main" style={{ maxWidth: "100%" }}>
                <p>
                  Every application sends email. Password resets, receipts, one-time codes —
                  messages where failure isn&rsquo;t an analytics dip but a user locked out of their
                  account. And yet the tooling treats these the same as Tuesday&rsquo;s newsletter
                  blast.
                </p>
                <p>That mismatch is the entire reason Avenor exists.</p>
                <h2>Delivery is the product</h2>
                <p>
                  Ask a developer what their email provider does and they&rsquo;ll say &ldquo;sends
                  email.&rdquo; Ask what keeps them up and it&rsquo;s never the sending — it&rsquo;s
                  the not-knowing. Did it arrive? Did it bounce? Why did this one fail? A provider
                  that answers those questions precisely is worth more than one that sends 4%
                  cheaper.
                </p>
                <h2>What we said no to</h2>
                <p>
                  No broadcasts, no audiences, no marketing automation. Every bulk-sending feature
                  we skip is reputation we don&rsquo;t share with spammers and focus we keep for the
                  OTP that must arrive in ten seconds. Constraints are features when you pick them
                  deliberately.
                </p>
                <h2>What we said yes to</h2>
                <p>
                  Idempotency keys on every send, because networks fail mid-request. Dead-letter
                  queues you can inspect, because silent loss is unacceptable. Naira pricing
                  alongside dollars, because great developers don&rsquo;t all live in San Francisco.
                  And design you can feel, because infrastructure doesn&rsquo;t have to look like
                  punishment.
                </p>
                <p>
                  This blog will document the building — the deliverability lessons, the
                  architecture calls, the incidents (with postmortems).{" "}
                  <Link href="/#start">Get a test key</Link> and watch your first email travel the
                  whole pipeline. That&rsquo;s the whole pitch.
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
