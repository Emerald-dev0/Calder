import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Migrate from Resend — Avenor Docs",
  description: "Concept mapping and migration steps from Resend to Avenor.",
};

const ROWS = [
  ["API key", "re_… secret", "avenor_sk_live_… — same Bearer pattern"],
  ["Send", "resend.emails.send()", "POST /v1/emails — same fields, 202 instead of 200"],
  ["Response id", "data.id (uuid)", "id (em_…) — track it the same way"],
  ["Test mode", "test API keys", "test keys — same idea, full simulation"],
  ["Webhooks", "event objects", "same events + visible retries and replay"],
  ["Broadcasts", "built in", "not offered — transactional only, by design"],
  ["React Email", "first-class", "send any rendered HTML today; templates soon"],
] as const;

export default function MigrateResend() {
  return (
    <>
      <h1>Migrate from Resend</h1>
      <p className="docs-lede">
        Same concepts, mechanical changes. Most teams finish in an afternoon — and gain idempotency
        plus inspectable failures in the trade.
      </p>
      <h2>Concept mapping</h2>
      <table className="docs-table">
        <thead>
          <tr>
            <th>Concern</th>
            <th>Resend</th>
            <th>Avenor</th>
          </tr>
        </thead>
        <tbody>
          {ROWS.map(([c, r, a]) => (
            <tr key={c}>
              <td>
                <b style={{ color: "var(--ink)" }}>{c}</b>
              </td>
              <td className="mono">{r}</td>
              <td>{a}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h2>Steps</h2>
      <ol>
        <li>
          Verify your domain here (same DNS, new values) — see{" "}
          <Link href="/docs/domains">Domains</Link>.
        </li>
        <li>
          Swap the send call; add an <span className="mono">Idempotency-Key</span> while
          you&rsquo;re in there.
        </li>
        <li>Re-register webhook endpoints and secrets.</li>
        <li>Run both providers in parallel, then cancel Resend.</li>
      </ol>
      <p>
        The full story, including why transactional-only is a deliverability feature, lives on the{" "}
        <Link href="/migrate">migration page</Link>.
      </p>
    </>
  );
}
