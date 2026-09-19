import Link from "next/link";

export const metadata = { title: "Calder — SMTP" };

/**
 * Honest placeholder: the SMTP gateway is specified (docs/SMTP.md) but NOT
 * built, so this page must not show connection details or point at a
 * credential-creation flow that doesn't exist. Today, the only working way
 * to send is the REST API with an API key.
 */
export default function SmtpPage() {
  return (
    <div>
      <h1 style={{ fontSize: 20, fontWeight: 700, margin: "0 0 8px" }}>SMTP</h1>
      <p style={{ color: "var(--color-muted)", fontSize: 13, margin: "0 0 16px" }}>
        Connect Nodemailer, Laravel Mail, Django SMTP-style clients directly to Calder.
      </p>
      <div
        style={{
          border: "1px solid var(--color-border)",
          borderRadius: 12,
          padding: 16,
          background: "#fff",
          fontSize: 14,
          lineHeight: 1.6,
        }}
      >
        <p style={{ fontWeight: 600, margin: "0 0 8px" }}>SMTP relay is not available yet.</p>
        <p style={{ color: "var(--color-muted)", margin: "0 0 8px" }}>
          The SMTP gateway is specified and on the roadmap, but it is not shipping yet, there is
          no host to connect to and no SMTP credentials to create. Anything claiming otherwise is
          a bug.
        </p>
        <p style={{ color: "var(--color-muted)", margin: 0 }}>
          Today, send with the REST API: create an API key under{" "}
          <Link href="/keys" style={{ color: "var(--color-signal)" }}>
            API Keys
          </Link>{" "}
          and call <span className="mono">POST /v1/emails</span> from any language or framework.
        </p>
      </div>
    </div>
  );
}
