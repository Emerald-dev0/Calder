import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "API Keys, Calder Docs",
  description: "Test vs live keys, creation, rotation, and revocation.",
};

export default function ApiKeys() {
  return (
    <>
      <h1>API Keys</h1>
      <p className="docs-lede">
        A key belongs to one project and one environment, is stored as a hash, and can be revoked
        without a deploy. Treat it like a password that happens to start with{" "}
        <span className="mono">calder_sk_</span>.
      </p>

      <h2>Test vs. live</h2>
      <p>
        Test keys (<span className="mono">calder_sk_test_…</span>) run the full pipeline, events and
        webhooks included, but never deliver real mail and never count against your plan. Live keys
        (<span className="mono">calder_sk_live_…</span>) deliver. The code is identical; only the
        key changes.
      </p>

      <h2>Creation</h2>
      <p>
        Keys are created per project in the dashboard. The secret is shown <b>once</b> because only
        its hash is stored, so a lost key is replaced rather than recovered. Name them after what
        uses them: <span className="mono">production-web</span> beats{" "}
        <span className="mono">key-3</span> the day you have to revoke one under pressure.
      </p>

      <h2>Rotation</h2>
      <p>
        Create the replacement, deploy it, confirm traffic is flowing, then revoke the old key. Both
        keys work during the overlap on purpose, so rotating never needs downtime.
      </p>

      <h2>Revocation</h2>
      <p>
        Revoked keys fail closed immediately. If a key leaks, revoke first and investigate second,
        then check the <Link href="/docs/webhooks">event history</Link> for anything sent while it
        was exposed.
      </p>
    </>
  );
}
