import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "API reference, Calder Docs",
  description:
    "Endpoints, authentication, idempotency, errors, and rate limits for the Calder v1 API.",
};

const ENDPOINTS = [
  ["POST", "/v1/emails", "Send an email. Returns 202 with the email id."],
  ["GET", "/v1/emails", "List emails in your project, newest first."],
  ["GET", "/v1/emails/:id", "Fetch one email with its current status."],
  ["GET/POST", "/v1/domains", "List domains / add a domain (returns a 72h DNS-TXT challenge)."],
  ["POST", "/v1/domains/:id/verify", "Attempt verification; failures return expected-vs-found diagnostics (10/hr)."],
  ["POST", "/v1/domains/:id/token", "Reissue the challenge after expiry."],
  ["DELETE", "/v1/domains/:id", "Remove a domain."],
  ["POST", "/v1/domains/:id/ses/link", "Register the SES identity; returns 3 DKIM CNAMEs (requires verified ownership)."],
  ["POST", "/v1/domains/:id/ses/refresh", "Poll DKIM/identity status until SES verifies."],
  ["GET", "/v1/projects", "List projects in your organization."],
  ["GET/POST", "/v1/webhooks", "List endpoints / register an endpoint (public https only; secret shown once)."],
  ["DELETE", "/v1/webhooks/:id", "Delete an endpoint; in-flight deliveries fail terminally."],
  ["POST", "/v1/webhooks/:id/rotate", "Rotate the signing secret (shown once; old secret dead immediately)."],
  ["GET", "/v1/webhooks/:id/deliveries", "Last 25 delivery attempts with status/latency/error."],
  ["POST", "/v1/webhooks/:id/deliveries/:deliveryId/replay", "Re-enqueue one delivery with its original data."],
] as const;

export default function ApiReference() {
  return (
    <>
      <h1>API reference</h1>
      <p className="docs-lede">
        Versioned from the first release at <span className="mono">/v1/…</span>. Authenticate with a
        Bearer API key, send idempotency keys on mutating calls, and expect the same error shape
        every time.
      </p>

      <h2>Authentication</h2>
      <p>
        <span className="mono">Authorization: Bearer calder_sk_live_…</span> Test keys (
        <span className="mono">…_test_…</span>) simulate everything and deliver nothing. Keys are
        scoped to one project and one environment, hashed at rest, revocable anytime.
      </p>

      <h2>Endpoints</h2>
      <table className="docs-table">
        <thead>
          <tr>
            <th>Method</th>
            <th>Path</th>
            <th>What it does</th>
          </tr>
        </thead>
        <tbody>
          {ENDPOINTS.map(([m, p, d]) => (
            <tr key={p + m}>
              <td className="mono">{m}</td>
              <td className="mono">{p}</td>
              <td>{d}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>Idempotency</h2>
      <p>
        Send <span className="mono">Idempotency-Key: &lt;your-unique-key&gt;</span> on{" "}
        <span className="mono">POST /v1/emails</span>. Repeating a key within 24 hours returns the
        original result with a <span className="mono">200</span> instead of sending twice.
      </p>

      <h2>Errors</h2>
      <p>
        Always <span className="mono">{"{ error: { code, message, request_id } }"}</span>. Common
        codes: <span className="mono">validation_error</span>,{" "}
        <span className="mono">authentication_error</span>,{" "}
        <span className="mono">authorization_error</span>,{" "}
        <span className="mono">domain_not_verified</span>, <span className="mono">suppressed</span>,{" "}
        <span className="mono">rate_limit_error</span>. Quote the{" "}
        <span className="mono">request_id</span> when contacting support.
      </p>

      <h2>Rate limits</h2>
      <p>
        Sending: 100/min. Verification: 10/min. Auth: 20/min. Every{" "}
        <span className="mono">429</span> includes limit, remaining, reset, and{" "}
        <span className="mono">Retry-After</span> headers.
      </p>
    </>
  );
}
