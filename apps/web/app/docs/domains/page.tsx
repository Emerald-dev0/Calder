import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Domains, Calder Docs",
  description:
    "Verify sending domains with DNS, understand hosted verification, and monitor domain health.",
};

export default function DomainsGuide() {
  return (
    <>
      <h1>Domains</h1>
      <p className="docs-lede">
        Sending from your own domain is the highest-leverage deliverability move you can make.
        Here&rsquo;s the whole walkthrough.
      </p>

      <h2>1. Add the domain</h2>
      <p>
        <span className="mono">POST /v1/domains</span> with{" "}
        <span className="mono">{"{ domain }"}</span>. You&rsquo;ll get back a verification token and
        the exact records to create.
      </p>

      <h2>2. Create the DNS records</h2>
      <p>
        Three records: a TXT token proving control, plus SPF, DKIM, and DMARC entries we generate
        for you. Copy-paste values, no selector archaeology. Then{" "}
        <span className="mono">POST /v1/domains/:id/verify</span>, we poll DNS with backoff and tell
        you specifically what&rsquo;s missing if it fails.
      </p>

      <h2>3. Watch its health</h2>
      <p>
        Verification isn&rsquo;t one-and-done: we re-check continuously and alert on regressions.
        Per-domain bounce and complaint rates live beside the status, so reputation is a number you
        watch, not a feeling you have.
      </p>

      <h2>Hosted domains (Vercel and friends)</h2>
      <p>
        Proving you control a <span className="mono">*.vercel.app</span> project doesn&rsquo;t prove
        anything about DNS, so hosted verification maps sending to an Calder-managed subdomain
        instead of pretending otherwise. Honest mechanism, same deliverability. Vercel first;
        Netlify, Cloudflare Pages, and GitHub Pages adapters follow the same interface.
      </p>

      <p>
        Next: <Link href="/docs/deliverability">the deliverability playbook</Link>.
      </p>
    </>
  );
}
