import Link from "next/link";
import { configuredProviders } from "@calder/auth";

const LABELS = { google: "Continue with Google", github: "Continue with GitHub" } as const;

export default function LoginPage() {
  const providers = configuredProviders();
  return (
    <div style={{ maxWidth: 420, margin: "12vh auto", padding: 24 }}>
      <p style={{ fontWeight: 700, fontSize: 22, margin: "0 0 6px" }}>Calder</p>
      <h1 style={{ fontSize: 26, margin: "0 0 8px" }}>Sign in</h1>
      <p style={{ color: "#737373", fontSize: 14, margin: "0 0 24px" }}>
        One account for every organization you belong to — including Calder itself.
      </p>
      {providers.length === 0 ? (
        <div
          style={{
            background: "#fff",
            border: "1px solid #E5E5E5",
            borderRadius: 12,
            padding: 20,
            fontSize: 14,
          }}
        >
          <p style={{ fontWeight: 600, margin: "0 0 6px" }}>OAuth isn&rsquo;t configured yet</p>
          <p style={{ color: "#737373", margin: 0 }}>
            Set <span className="mono">GOOGLE_CLIENT_ID</span> /{" "}
            <span className="mono">GOOGLE_CLIENT_SECRET</span> or the GitHub equivalents, then
            restart the dashboard. Callback URL ends in{" "}
            <span className="mono">/api/auth/callback/&lt;provider&gt;</span>.
          </p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {providers.map((p) => (
            <Link
              key={p}
              href={`/api/auth/${p}`}
              style={{
                display: "block",
                textAlign: "center",
                background: "#0B0C0E",
                color: "#fff",
                borderRadius: 10,
                padding: "12px 16px",
                fontSize: 15,
                fontWeight: 600,
                textDecoration: "none",
              }}
            >
              {LABELS[p]}
            </Link>
          ))}
        </div>
      )}
      <p style={{ color: "#737373", fontSize: 12, marginTop: 20 }}>
        New here? Signing in creates your account automatically — founders listed in{" "}
        <span className="mono">FOUNDER_EMAILS</span> are granted the Calder org on first login.
      </p>
    </div>
  );
}
