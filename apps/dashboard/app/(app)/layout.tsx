import Link from "next/link";
import { getConfig } from "@calder/config";
import { getTenantContext } from "../../lib/auth";
import { ContextSwitcher } from "../../components/context-switcher";
import { OnboardingGate } from "../../components/onboarding-gate";
import { CalderLockup } from "@calder/ui";
import { PlanBadge } from "../../components/plan-gate";

function isFounder(email: string): boolean {
  const founders = (getConfig().FOUNDER_EMAILS ?? "")
    .split(", ")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return founders.includes(email.toLowerCase());
}

const NAV_GROUPS: Array<{ heading: string; items: Array<{ label: string; href: string | null; tier?: "PRO" | "PREMIUM" | "SCALE"; founder?: boolean }> }> = [
  { heading: "Workspace", items: [{ label: "Overview", href: "/" }] },
  {
    heading: "SEND",
    items: [
      { label: "Email", href: "/emails" },
      { label: "Templates", href: "/templates" },
      { label: "Senders", href: "/senders" },
    ],
  },
  {
    heading: "RECEIVE",
    items: [
      { label: "Inbox", href: "/inbox", tier: "PRO" },
      { label: "Webhooks", href: "/webhooks" },
    ],
  },
  {
    heading: "DEVELOP",
    items: [
      { label: "API Keys", href: "/keys" },
      { label: "SDKs", href: "/sdks" },
      { label: "SMTP", href: "/smtp" },
      { label: "Logs", href: "/logs" },
    ],
  },
  {
    heading: "CONFIGURE",
    items: [
      { label: "Domains", href: "/domains" },
      { label: "Integrations", href: "/integrations" },
    ],
  },
  {
    heading: "OBSERVE",
    items: [
      { label: "Deliveries", href: "/deliveries" },
      { label: "Analytics", href: "/analytics", tier: "PRO" },
      { label: "Suppressions", href: "/suppressions" },
      { label: "Usage", href: "/usage" },
    ],
  },
  {
    heading: "ORGANIZATION",
    items: [
      { label: "Team", href: "/team", tier: "PRO" },
      { label: "Audit Logs", href: "/audit-logs", tier: "PREMIUM" },
    ],
  },
  { heading: "", items: [{ label: "Settings", href: "/settings" }, { label: "Control Plane", href: "/control", founder: true }] },
];

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getTenantContext();
  const showAdmin = isFounder(ctx.user.email);
  const visibleGroups = NAV_GROUPS.map((g) => ({ ...g, items: g.items.filter((i) => !(i.founder && !showAdmin)) })).filter((g) => g.items.length > 0);
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
          {visibleGroups.map((group) => (
            <div key={group.heading} style={{ marginBottom: group.heading ? 14 : 0 }}>
              {group.heading && <div style={{ fontSize: 10, letterSpacing: "0.08em", color: "var(--color-muted)", margin: "10px 0 6px", fontWeight: 700 }}>{group.heading}</div>}
              {group.items.map((item) =>
                item.href ? (
                  <Link key={item.label} href={item.href} className="dash-link" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span>{item.label}</span>
                    {item.tier && <PlanBadge tier={item.tier} />}
                  </Link>
                ) : (
                  <span key={item.label} className="dash-link dash-soon">
                    {item.label}
                    <span className="mono" style={{ fontSize: 10 }}>soon</span>
                  </span>
                )
              )}
            </div>
          ))}
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
          {visibleGroups.flatMap((g) => g.items).map((item) =>
            item.href ? (
              <Link key={item.label} href={item.href} className="dash-tab" style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                {item.label} {item.tier && <span style={{ fontSize: 9, border: "1px solid var(--color-border)", padding: "0 4px", borderRadius: 3 }}>{item.tier}</span>}
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
