import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Migrate from Postmark — Avenor Docs",
  description: "Concept mapping and migration steps from Postmark to Avenor.",
};

const ROWS = [
  ["Auth", "X-Postmark-Server-Token header", "Authorization: Bearer avenor_sk_live_…"],
  [
    "Send",
    "POST /email with From/To/Subject",
    "POST /v1/emails with from/to/subject — near-identical fields",
  ],
  ["Templates", "TemplateId + TemplateModel", "Send rendered HTML today; versioned templates soon"],
  [
    "Message streams",
    "Transactional vs broadcast streams",
    "No streams needed — transactional-only, one reputation pool",
  ],
  ["Webhooks", "Configured per stream", "Per-project endpoints with retries and replay"],
  ["Suppression", "Suppression list", "Automatic suppression with logged reasons"],
] as const;

export default function MigratePostmark() {
  return (
    <>
      <h1>Migrate from Postmark</h1>
      <p className="docs-lede">
        Postmark veterans will feel at home: strict transactional focus, delivery obsession, honest
        errors. The field names rhyme; the auth header changes.
      </p>
      <h2>Concept mapping</h2>
      <table className="docs-table">
        <thead>
          <tr>
            <th>Concern</th>
            <th>Postmark</th>
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
          Verify your domain here — see <Link href="/docs/domains">Domains</Link>.
        </li>
        <li>
          Replace the token header and endpoint; add idempotency keys (Postmark has no equivalent —
          enjoy this part).
        </li>
        <li>Re-register webhooks; export and re-import suppressions.</li>
        <li>Run in parallel, then wind Postmark down.</li>
      </ol>
    </>
  );
}
