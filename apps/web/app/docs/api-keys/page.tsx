import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "API Keys — Calder Docs",
  description: "Test vs live keys, creation, rotation, and revocation.",
};

export default function ApiKeys() {
  return (
    <>
      <h1>API Keys</h1>
      <p className="docs-lede">
        Scoped to one project and one environment, hashed at rest, revocable in one click. Treat
        them like passwords that happen to start with <span className="mono">calder_sk_</span>.
      </p>

      <h2>Test vs. live</h2>
      <p>
        Test keys (<span className="mono">calder_sk_test_…</span>) run the entire pipeline —
        validation, queue, provider simulation, events, webhooks — without delivering anything real
        or metering anything. Live keys (<span className="mono">calder_sk_live_…</span>) deliver for
        real. Same code, different key, zero surprises.
      </p>

      <h2>Creation</h2>
      <p>
        Create keys per project in the dashboard. The secret is shown <b>once</b> — we store only
        the hash, so a lost key can&rsquo;t be recovered, only replaced. Name keys after their
        purpose (<span className="mono">production-web</span>, not{" "}
        <span className="mono">key-3</span>).
      </p>

      <h2>Rotation</h2>
      <p>
        Create the replacement, deploy it, verify traffic, then revoke the old one. Overlap is
        intentional — rotation should never require downtime or a 3am deploy.
      </p>

      <h2>Revocation</h2>
      <p>
        Revoked keys fail closed immediately. If a key leaks, revoke first and investigate second —
        then check the <Link href="/docs/webhooks">event history</Link> for anything sent while it
        was exposed.
      </p>
    </>
  );
}
