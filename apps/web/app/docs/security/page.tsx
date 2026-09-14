import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Security, Calder Docs",
  description: "How Calder handles keys, secrets, and webhook signatures. Developer's-eye view.",
};

export default function SecurityDoc() {
  return (
    <>
      <h1>Security</h1>
      <p className="docs-lede">
        What you need to do on your side, and what Calder guarantees on ours. The full policy is
        <span className="mono">SECURITY.md</span> in the repository; this page is the short version
        for developers.
      </p>

      <h2>Your keys</h2>
      <p>
        Keep keys in environment variables or a secret manager, never in a client bundle and never
        in git. Rotate them on a schedule, and straight away if one leaks. Test and live keys are
        separate credentials, and a test key cannot deliver real mail.
      </p>

      <h2>Our guarantees</h2>
      <p>
        Keys are stored as hashes, so we can show you a prefix and never the secret itself. Every
        query is scoped to one organization and project at the data layer. Webhook payloads are
        HMAC-signed and worth verifying. Error responses carry a request ID and nothing else. The
        fuller picture is on the <Link href="/security">security page</Link>.
      </p>

      <h2>Reporting issues</h2>
      <p>
        Send it to <b className="mono">support@calder.click</b> with &ldquo;security&rdquo; in the
        subject line. It gets read the same day, and you will hear back as the fix progresses,
        including when we conclude something is not a vulnerability.
      </p>
    </>
  );
}
