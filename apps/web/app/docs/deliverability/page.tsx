import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Deliverability, Calder Docs",
  description: "Reach inboxes: authentication, reputation, content, and list hygiene with Calder.",
};

export default function Deliverability() {
  return (
    <>
      <h1>Deliverability</h1>
      <p className="docs-lede">
        Deliverability is decided over months by inbox providers watching how recipients react to
        your mail. Most of what protects you is configuration; the rest is who you send to.
      </p>

      <h2>Authenticate everything</h2>
      <p>
        SPF, DKIM and DMARC are how a receiving server confirms that a message claiming to come
        from your domain actually did. Set them up under{" "}
        <Link href="/domains">Domains</Link> before your first real send; mail without them is
        filtered far more aggressively.
      </p>

      <h2>Warm up gradually</h2>
      <p>
        A new domain has no history, and inbox providers treat sudden volume from an unknown
        sender as a risk signal. Calder starts new domains below full throughput and raises the
        ceiling as your delivery record accumulates.
      </p>

      <h2>Keep bounces and complaints near zero</h2>
      <p>
        Two numbers get senders blocked everywhere, not only here: sustained bounces above roughly
        2% and complaints above roughly 0.1%. The suppression list refuses known-bad addresses for
        you, but the durable fix is upstream: verify addresses at signup and make unsubscribing
        easy to find.
      </p>

      <h2>Send what people asked for</h2>
      <p>
        Mail your users triggered will always outperform mail they did not. That is why Calder
        keeps the two apart: campaigns run on their own stream with their own reputation, so a
        difficult week of marketing cannot damage the password reset a customer is waiting for.
      </p>

      <h2>Watch the dashboard, not your gut</h2>
      <p>
        Per-domain bounce and complaint rates, verification state, and event timelines turn
        &ldquo;delivery feels off&rdquo; into a diagnosable, fixable, specific thing.
      </p>
    </>
  );
}
