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
        Sending from your own domain is the single biggest deliverability improvement available to
        you. It takes three DNS records and about ten minutes.
      </p>

      <h2>1. Add the domain</h2>
      <p>
        <span className="mono">POST /v1/domains</span> with{" "}
        <span className="mono">{"{ domain }"}</span>. You&rsquo;ll get back a verification token and
        the exact records to create.
      </p>

      <h2>2. Create the DNS records</h2>
      <p>
        Calder generates the records: a TXT token proving you control the domain, plus SPF, DKIM and
        DMARC entries with the selectors already filled in. Paste them at your DNS provider, then
        call <span className="mono">POST /v1/domains/:id/verify</span>. Verification retries with
        backoff, and a failure names the record that is missing or wrong instead of asking you to
        try again.
      </p>

      <h2>3. Watch its health</h2>
      <p>
        DNS records get deleted by accident, so verification re-runs on a schedule and a regression
        is reported. Per-domain bounce and complaint rates are being wired in from provider
        feedback; until they appear, the delivery log is the record to read.
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
