import type { Metadata } from "next";
import Link from "next/link";
import { CodeBlock } from "../../../components/code";

export const metadata: Metadata = {
  title: "Domains, Calder Docs",
  description:
    "Verify domain ownership with a DNS TXT challenge, then enable DKIM-signed branded sending via SES. Honest, two-step, propagation-tolerant.",
};

const FLOW = `# Step 1 — prove ownership
curl -X POST https://api.calder.click/v1/domains \\
  -H "Authorization: Bearer calder_sk_live_…" \\
  -H "content-type: application/json" \\
  -d '{"domain":"acme.com"}'

# → publish exactly one record at your DNS provider:
#   _calder.acme.com  TXT  "calder-verification=cvt_1a2b…(48 hex chars)"

curl -X POST https://api.calder.click/v1/domains/dom_abc123/verify \\
  -H "Authorization: Bearer calder_sk_live_…"
# → 200 {"data":{"status":"verified"}}            — record matched
# → 200 {"data":{"status":"failed","expected":{…},"found":[…]}}  — not propagated yet
# → 429                                          — over 10 attempts/hour, wait

# Step 2 — branded signing (DKIM), after ownership verified
curl -X POST https://api.calder.click/v1/domains/dom_abc123/ses/link \\
  -H "Authorization: Bearer calder_sk_live_…"
# → 3 DKIM CNAMEs to paste, then poll until SES sees them:
curl -X POST https://api.calder.click/v1/domains/dom_abc123/ses/refresh \\
  -H "Authorization: Bearer calder_sk_live_…"`;

export default function DomainsGuide() {
  return (
    <>
      <h1>Domains</h1>
      <p className="docs-lede">
        Sending from your own domain is the single biggest deliverability improvement available to
        you. Verification is two honest steps: first prove you control the DNS, then sign your mail
        with it.
      </p>

      <h2>1. Prove ownership (one TXT)</h2>
      <p>
        <span className="mono">POST /v1/domains</span> with{" "}
        <span className="mono">{"{ domain }"}</span> and you get a challenge: publish{" "}
        <span className="mono">_calder.&lt;domain&gt; TXT calder-verification=cvt_…</span>. The
        token has 192 bits of entropy and the challenge expires after 72 hours. Call{" "}
        <span className="mono">POST /v1/domains/:id/verify</span> when the record is live — failures
        return the expected value and the records we actually found, so propagation delays are
        diagnosable instead of mysterious. Attempts are rate-limited (10/hour) and retries are
        welcome.
      </p>

      <h2>2. Enable DKIM signing (3 CNAMEs)</h2>
      <p>
        Once a domain is verified, <span className="mono">POST /v1/domains/:id/ses/link</span>{" "}
        registers it as a SES sending identity and returns the three DKIM CNAME records. Publish
        them, then poll <span className="mono">/:id/ses/refresh</span> until SES reports success —
        the dashboard wizard watches this for you every 20 seconds. We also show the recommended SPF
        record (<span className="mono">v=spf1 include:amazonses.com ~all</span>), but we never
        silently merge it into an existing SPF policy: that's a change you make at your DNS
        provider, knowingly.
      </p>

      <CodeBlock title="full flow, REST" copyText={FLOW}>
        {FLOW}
      </CodeBlock>

      <h2>Rules worth knowing</h2>
      <p>
        A domain can only be <em>verified</em> by one workspace: if another organization proves it
        first, registration and verification both return 409 — DNS is the arbiter, not first-come
        registration. Ownership and branding are separate gates on purpose: unverified domains keep
        sending through shared infrastructure, and verified-but-undelivered-DKIM keeps sending
        unbranded. Nothing blocks on cosmetics.
      </p>
      <p>
        The dashboard's <Link href="/domains">Domains</Link> page runs this same flow as a wizard
        with the challenge value, live DNS checking, failure diagnostics, and DKIM polling. Full
        endpoint detail in <Link href="/docs/api-reference">API reference</Link>.
      </p>
    </>
  );
}
