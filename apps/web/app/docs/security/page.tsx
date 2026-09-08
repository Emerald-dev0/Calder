import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Security — Calder Docs",
  description: "How Calder handles keys, secrets, and webhook signatures. Developer's-eye view.",
};

export default function SecurityDoc() {
  return (
    <>
      <h1>Security</h1>
      <p className="docs-lede">
        What you must do on your side, and what we guarantee on ours. The full internal policy lives
        in our <span className="mono">SECURITY.md</span> — this page is the developer&rsquo;s-eye
        summary.
      </p>

      <h2>Your keys</h2>
      <p>
        Store keys in environment variables or a secret manager — never in client bundles, never in
        git. Rotate on a schedule and immediately on any suspected leak. Test and live keys are
        cryptographically distinct; a test key can never deliver real mail.
      </p>

      <h2>Our guarantees</h2>
      <p>
        Keys are hashed at rest (we can show a prefix, never the secret). Every tenant query is
        scoped by organization and project at the data layer. Webhook payloads are HMAC-signed;
        verify them. Error responses carry request IDs, never stack traces or secrets. See the full
        posture on our <Link href="/security">security page</Link>.
      </p>

      <h2>Reporting issues</h2>
      <p>
        Found something? Write to <b className="mono">support@calder.click</b> with
        &ldquo;security&rdquo; in the subject. We triage the same day and will keep you posted
        through the fix.
      </p>
    </>
  );
}
