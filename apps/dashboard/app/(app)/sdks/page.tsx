export const metadata = { title: "Calder — SDKs" };

export default function SdksPage() {
  return (
    <div>
      <h1 style={{ fontSize: 20, fontWeight: 700, margin: "0 0 8px" }}>SDKs</h1>
      <p style={{ color: "var(--color-muted)", fontSize: 13, margin: "0 0 16px" }}>Copy-paste for your stack.</p>
      <div style={{ border: "1px solid var(--color-border)", borderRadius: 12, padding: 16, background: "#fff", margin: "12px 0" }}>
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          {["Node.js", "Python", "cURL"].map((k) => (
            <span key={k} style={{ fontSize: 12, border: "1px solid var(--color-border)", padding: "4px 8px", borderRadius: 6, background: "var(--color-paper)" }}>{k}</span>
          ))}
        </div>
        <pre style={{ background: "var(--color-paper)", padding: 12, borderRadius: 8, fontSize: 12, overflow: "auto" }}>{`const calder = new Calder({ apiKey: process.env.CALDER_API_KEY });
await calder.emails.send({ from: "hello@calder.click", to: "you@example.com", subject: "Hi", html: "<p>Hi</p>" });`}</pre>
      </div>
    </div>
  );
}
