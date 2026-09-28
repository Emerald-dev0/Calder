export const metadata = { title: "Calder — Integrations" };

export default function IntegrationsPage() {
  return (
    <div>
      <h1 style={{ fontSize: 20, fontWeight: 700, margin: "0 0 8px" }}>Integrations</h1>
      <p style={{ color: "var(--color-muted)", fontSize: 13, margin: "0 0 16px" }}>
        Authentication is who you are. Integrations are what your project can do.
      </p>
      <div
        style={{
          display: "grid",
          gap: 12,
          gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
        }}
      >
        <div
          style={{
            border: "1px solid var(--color-border)",
            borderRadius: 12,
            padding: 16,
            background: "#fff",
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: 4 }}>Gmail</div>
          <div style={{ fontSize: 13, color: "var(--color-muted)", marginBottom: 12 }}>
            Connect a Gmail account to send without a custom domain. Separate from Google Sign-In.
          </div>
          <a href="/senders" style={{ fontSize: 13, fontWeight: 600, color: "var(--color-ink)" }}>
            Connect Gmail →
          </a>
        </div>
        <div
          style={{
            border: "1px solid var(--color-border)",
            borderRadius: 12,
            padding: 16,
            background: "#fff",
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: 4 }}>GitHub</div>
          <div style={{ fontSize: 13, color: "var(--color-muted)", marginBottom: 12 }}>
            Connect GitHub for repo context. Not required for sending.
          </div>
          <span style={{ fontSize: 13, color: "var(--color-muted)" }}>Soon</span>
        </div>
        <div
          style={{
            border: "1px solid var(--color-border)",
            borderRadius: 12,
            padding: 16,
            background: "#fff",
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: 4 }}>Vercel</div>
          <div style={{ fontSize: 13, color: "var(--color-muted)", marginBottom: 12 }}>
            Link Vercel projects for hosted-domain verification.
          </div>
          <span style={{ fontSize: 13, color: "var(--color-muted)" }}>Soon</span>
        </div>
      </div>
      <p style={{ fontSize: 12, color: "var(--color-muted)", marginTop: 12 }}>
        Google Sign-In authenticates you. Gmail connection authorizes sending — they are distinct
        and scopes never mix.
      </p>
    </div>
  );
}
