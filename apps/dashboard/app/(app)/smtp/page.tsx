export const metadata = { title: "Calder — SMTP" };

export default function SmtpPage() {
  return (
    <div>
      <h1 style={{ fontSize: 20, fontWeight: 700, margin: "0 0 8px" }}>SMTP</h1>
      <p style={{ color: "var(--color-muted)", fontSize: 13, margin: "0 0 16px" }}>Use Nodemailer, Laravel Mail, Django SMTP without extra config.</p>
      <div style={{ border: "1px solid var(--color-border)", borderRadius: 12, padding: 16, background: "#fff" }}>
        <div style={{ fontSize: 12, color: "var(--color-muted)", marginBottom: 8 }}>Host</div>
        <code style={{ background: "var(--color-paper)", padding: "4px 8px", borderRadius: 6, fontSize: 13 }}>smtp.calder.click</code>
        <div style={{ marginTop: 12, fontSize: 12, color: "var(--color-muted)" }}>Port 587 (STARTTLS) — Project-scoped credentials, shown once, hashed at rest. Create in API Keys → SMTP.</div>
      </div>
    </div>
  );
}
