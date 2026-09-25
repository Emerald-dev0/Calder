import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Deliverability, Calder Docs",
  description:
    "Bounce-rate chains, suppression lists, and domain authentication — the mechanics Calder enforces, and what stays on you.",
};

export default function Deliverability() {
  return (
    <>
      <h1>Deliverability</h1>
      <p className="docs-lede">
        Inbox providers score senders over weeks by watching how recipients react to their mail.
        Calder enforces the parts that can be engineered; this page is what&rsquo;s engineered,
        and what remains yours to run well.
      </p>

      <h2>Authenticate the domain you send from</h2>
      <p>
        DKIM and SPF are how a receiving server confirms that a message claiming to come from
        your domain really did. Set them up under <Link href="/docs/domains">Domains</Link>; the
        wizard walks from one ownership TXT to three DKIM CNAMEs, and unbranded sending keeps
        working the whole time. DMARC policy is yours to publish at DNS — we don&rsquo;t write
        one for you, and wouldn&rsquo;t want to.
      </p>

      <h2>The bounce-rate chain of truth</h2>
      <p>
        Provider feedback (bounces, complaints) flows back through signed SNS events, updates
        the delivery record, and feeds a live bounce-rate calculation. A bounce also suppresses
        the address: the suppression list then refuses that recipient on future sends, so a bad
        import can&rsquo;t quietly torch your reputation twice. This chain (event → state →
        refusal) is integration-tested end to end, not best-effort product copy.
      </p>

      <h2>Keep bounces and complaints near zero</h2>
      <p>
        Two numbers get senders blocked everywhere, not only here: sustained bounces above
        roughly 2% and complaints above roughly 0.1%. The durable fix is upstream — verify
        addresses at signup, honor unsubscribes fast, and send only what recipients asked for.
        Transactional mail your users triggered will always have a better record than bulk mail;
        keep them cleanly separated and neither stream pollutes the other.
      </p>

      <h2>Watch the dashboard, not your gut</h2>
      <p>
        Delivery state per email, per-endpoint webhook results, and the workspace audit log are
        all live reads over the same rows the system wrote — &ldquo;delivery feels off&rdquo;
        becomes a diagnosable, specific thing instead of a hunch.
      </p>
    </>
  );
}
