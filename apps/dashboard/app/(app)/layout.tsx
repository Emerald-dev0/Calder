import Link from "next/link";
import { getConfig } from "@calder/config";
import { getTenantContext } from "../../lib/auth";
import { ContextSwitcher } from "../../components/context-switcher";
import { OnboardingGate } from "../../components/onboarding-gate";
import { CalderLockup } from "@calder/ui";

function isFounder(email: string): boolean {
  const founders = (getConfig().FOUNDER_EMAILS ?? "")
    .split(", ")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return founders.includes(email.toLowerCase());
}

const NAV = [
  { label: "Overview", href: "/" },
  { label: "Onboarding", href: "/onboarding" },
  { label: "Emails", href: "/emails" },
  { label: "Domains", href: "/domains" },
  { label: "API Keys", href: "/keys" },
  { label: "Webhooks", href: "/webhooks" },
  { label: "Usage", href: "/usage" },
  { label: "Billing", href: null },
  { label: "Settings", href: "/settings" },
  { label: "Admin", href: "/admin", founder: true },
] as const;

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getTenantContext();
  const showAdmin = isFounder(ctx.user.email);
  const visibleNav = NAV.filter((item) => !("founder" in item) || showAdmin);
  const memberships = ctx.memberships.map((m) => ({
    organization: { id: m.organization.id, name: m.organization.name, slug: m.organization.slug },
    role: m.role,
    projects: m.projects.map((p) => ({
      id: p.id,
      name: p.name,
      slug: p.slug,
      environment: p.metadata?.environment ?? "development",
    })),
  }));
  return (
    <div className="dash-shell">
      <OnboardingGate orgCount={ctx.memberships.length} />
      <aside className="dash-sidebar">
        <div style={{ margin: "0 0 4px" }}>
          <CalderLockup size={20} />
        </div>
        <p className="mono dash-email" title={ctx.user.email}>
          {ctx.user.email}
        </p>
        <ContextSwitcher memberships={memberships} />
        <nav aria-label="Dashboard" className="dash-nav">
          {visibleNav.map((item) =>
            item.href ? (
              <Link key={item.label} href={item.href} className="dash-link">
                {item.label}
              </Link>
            ) : (
              <span key={item.label} className="dash-link dash-soon">
                {item.label}
                <span className="mono" style={{ fontSize: 10 }}>
                  soon
                </span>
              </span>
            )
          )}
        </nav>
        <form action="/api/auth/logout" method="POST" style={{ marginTop: 24 }}>
          <button type="submit" className="dash-signout">
            Sign out
          </button>
        </form>
      </aside>
      <div className="dash-main-col">
        <header className="dash-topbar">
          <span style={{ fontWeight: 700 }}>Calder</span>
          <span className="mono dash-topbar-email" title={ctx.user.email}>
            {ctx.user.email}
          </span>
          <form action="/api/auth/logout" method="POST">
            <button type="submit" className="dash-logout dash-logout-compact" aria-label="Sign out">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path
                  d="M6 3H3v10h3M10 5l3 3-3 3M13 8H6"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          </form>
        </header>
        <div className="dash-context-mobile">
          <ContextSwitcher memberships={memberships} compact />
        </div>
        <nav aria-label="Dashboard" className="dash-tabs">
          {visibleNav.map((item) =>
            item.href ? (
              <Link key={item.label} href={item.href} className="dash-tab">
                {item.label}
              </Link>
            ) : (
              <span key={item.label} className="dash-tab dash-soon">
                {item.label}
              </span>
            )
          )}
        </nav>
        <main className="dash-main">{children}</main>
      </div>
    </div>
  );
}
