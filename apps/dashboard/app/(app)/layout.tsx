import Link from "next/link";
import { getTenantContext } from "../../lib/auth";

const NAV = [
  { label: "Overview", href: "/" },
  { label: "Onboarding", href: "/onboarding" },
  { label: "Emails", href: "/emails" },
  { label: "Domains", href: "/domains" },
  { label: "API Keys", href: "/keys" },
  { label: "Webhooks", href: "/webhooks" },
  { label: "Usage", href: "/usage" },
  { label: "Billing", href: null },
  { label: "Settings", href: null },
] as const;

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getTenantContext();
  return (
    <div style={{ display: "flex", minHeight: "100vh" }}>
      <aside
        style={{ width: 240, borderRight: "1px solid #E5E5E5", padding: 24, background: "#fff" }}
      >
        <p style={{ fontWeight: 700, fontSize: 18, margin: "0 0 4px" }}>Calder</p>
        <p
          className="mono"
          style={{
            fontSize: 11,
            color: "#737373",
            margin: "0 0 20px",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
          title={ctx.user.email}
        >
          {ctx.user.email}
        </p>
        <nav style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 14 }}>
          {NAV.map((item) =>
            item.href ? (
              <Link
                key={item.label}
                href={item.href}
                style={{
                  padding: "8px 12px",
                  borderRadius: 6,
                  textDecoration: "none",
                  color: "#0B0C0E",
                }}
              >
                {item.label}
              </Link>
            ) : (
              <span
                key={item.label}
                style={{
                  padding: "8px 12px",
                  borderRadius: 6,
                  color: "#B5B5B5",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                {item.label}
                <span className="mono" style={{ fontSize: 10 }}>
                  soon
                </span>
              </span>
            )
          )}
        </nav>
        <form action="/api/auth/logout" method="POST" style={{ marginTop: 24 }}>
          <button
            type="submit"
            style={{
              background: "none",
              border: "none",
              padding: "8px 12px",
              fontSize: 14,
              color: "#737373",
              cursor: "pointer",
            }}
          >
            Sign out
          </button>
        </form>
      </aside>
      <main style={{ flex: 1, padding: 32 }}>{children}</main>
    </div>
  );
}
