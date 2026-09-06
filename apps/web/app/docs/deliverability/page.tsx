import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Deliverability — Avenor Docs",
  description: "Reach inboxes: authentication, reputation, content, and list hygiene with Avenor.",
};

export default function Deliverability() {
  return (
    <>
      <h1>Deliverability</h1>
      <p className="docs-lede">
        Delivery is a reputation game played over months. Here&rsquo;s how to win it — most of it
        automated, all of it visible.
      </p>

      <h2>Authenticate everything</h2>
      <p>
        SPF, DKIM, and DMARC prove you are who you claim to be. Set them up under{" "}
        <Link href="/domains">Domains</Link> before sending anything real. Unauthenticated mail is
        the single fastest route to spam folders.
      </p>

      <h2>Warm up gradually</h2>
      <p>
        New domains start with limits that lift as your reputation builds. This isn&rsquo;t
        punishment — inbox providers distrust sudden volume from unknown senders, and ramping
        protects the reputation you&rsquo;re building.
      </p>

      <h2>Keep bounces and complaints near zero</h2>
      <p>
        Sustained bounce rates above ~2% or complaint rates above ~0.1% will hurt you everywhere,
        not just with us. Our suppression list enforces this automatically — but the real fix is
        verifying addresses at signup and making unsubscribe obvious.
      </p>

      <h2>Send what people asked for</h2>
      <p>
        Transactional email has a natural advantage: the recipient triggered it. Keep it that way.
        Avenor is not a bulk-marketing platform, and that focus is part of why transactional senders
        here land in inboxes.
      </p>

      <h2>Watch the dashboard, not your gut</h2>
      <p>
        Per-domain bounce and complaint rates, verification state, and event timelines turn
        &ldquo;delivery feels off&rdquo; into a diagnosable, fixable, specific thing.
      </p>
    </>
  );
}
