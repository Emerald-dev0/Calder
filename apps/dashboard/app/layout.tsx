import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Avenor Dashboard",
  description: "Manage projects, API keys, domains, emails, and webhooks.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div style={{ display: "flex", minHeight: "100vh" }}>
          <aside
            style={{
              width: 240,
              borderRight: "1px solid #E5E5E5",
              padding: 24,
              background: "#fff",
            }}
          >
            <p style={{ fontWeight: 700, fontSize: 18, margin: "0 0 24px" }}>Avenor</p>
            <nav style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 14 }}>
              {[
                "Overview",
                "Emails",
                "Domains",
                "API Keys",
                "Webhooks",
                "Usage",
                "Billing",
                "Settings",
              ].map((item, i) => (
                <a
                  key={item}
                  href="#"
                  style={{
                    padding: "8px 12px",
                    borderRadius: 6,
                    textDecoration: "none",
                    color: i === 0 ? "#0B0C0E" : "#737373",
                    background: i === 0 ? "#F5F4EF" : "transparent",
                    fontWeight: i === 0 ? 600 : 400,
                  }}
                >
                  {item}
                </a>
              ))}
            </nav>
          </aside>
          <main style={{ flex: 1, padding: 32 }}>{children}</main>
        </div>
      </body>
    </html>
  );
}
