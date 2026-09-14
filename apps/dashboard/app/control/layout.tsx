import Link from "next/link";
import type { ReactNode } from "react";
import { canAccessSection, CONTROL_ROLE_LABEL } from "@/lib/control/roles";
import { requireControl } from "@/lib/control/guard";
import { MobileNav, SidebarNav, type NavGroup } from "./_components/nav";
import "./control.css";

/**
 * Sections visible per role. The sidebar is enforcement-shaped: it renders
 * from ROLE_SECTIONS (the same source the page guards check), so what you
 * see is exactly what you may reach.
 */
const NAV: Array<{ section: string; heading: string; items: Array<{ label: string; href: string; exact?: boolean; badge?: string }> }> = [
  {
    section: "overview",
    heading: "Overview",
    items: [{ label: "Command Center", href: "/control", exact: true }],
  },
  {
    section: "growth",
    heading: "Growth",
    items: [
      { label: "Overview", href: "/control/growth" },
      { label: "Waitlist", href: "/control/growth/waitlist" },
      { label: "Acquisition", href: "/control/growth/acquisition" },
      { label: "Referrals", href: "/control/growth/referrals" },
    ],
  },
  {
    section: "customers",
    heading: "Customers",
    items: [
      { label: "Users", href: "/control/customers" },
      { label: "Organizations", href: "/control/customers/organizations" },
      { label: "Projects", href: "/control/customers/projects" },
      { label: "Customer Health", href: "/control/customers/health" },
      { label: "Support", href: "/control/customers/support" },
    ],
  },
  {
    section: "communications",
    heading: "Communications",
    items: [
      { label: "Broadcasts", href: "/control/communications" },
      { label: "Audiences", href: "/control/communications/audiences" },
      { label: "Templates", href: "/control/communications/templates" },
      { label: "Delivery", href: "/control/communications/delivery" },
      { label: "Campaigns", href: "/control/communications/campaigns" },
      { label: "Automations", href: "/control/communications/automations" },
    ],
  },
  {
    section: "billing",
    heading: "Billing",
    items: [
      { label: "Overview", href: "/control/billing" },
      { label: "Subscriptions", href: "/control/billing/subscriptions" },
      { label: "Plans", href: "/control/billing/plans" },
      { label: "Coupons", href: "/control/billing/coupons" },
      { label: "Credits", href: "/control/billing/credits" },
      { label: "Invoices", href: "/control/billing/invoices" },
      { label: "Entitlements", href: "/control/billing/entitlements" },
    ],
  },
  {
    section: "platform",
    heading: "Platform",
    items: [
      { label: "Email", href: "/control/platform" },
      { label: "API", href: "/control/platform/api" },
      { label: "Webhooks", href: "/control/platform/webhooks" },
      { label: "Deliverability", href: "/control/platform/deliverability" },
      { label: "Usage", href: "/control/platform/usage" },
    ],
  },
  {
    section: "infrastructure",
    heading: "Infrastructure",
    items: [
      { label: "Overview", href: "/control/infrastructure" },
      { label: "Redis", href: "/control/infrastructure/redis" },
      { label: "Queues", href: "/control/infrastructure/queues" },
      { label: "Workers", href: "/control/infrastructure/workers" },
      { label: "Database", href: "/control/infrastructure/database" },
      { label: "Providers", href: "/control/infrastructure/providers" },
      { label: "Storage", href: "/control/infrastructure/storage" },
      { label: "Cron", href: "/control/infrastructure/cron" },
      { label: "Networking", href: "/control/infrastructure/networking" },
    ],
  },
  {
    section: "observability",
    heading: "Observability",
    items: [
      { label: "Logs", href: "/control/observability" },
      { label: "Metrics", href: "/control/observability/metrics" },
      { label: "Alerts", href: "/control/observability/alerts" },
      { label: "Incidents", href: "/control/observability/incidents" },
    ],
  },
  {
    section: "security",
    heading: "Security",
    items: [
      { label: "Abuse", href: "/control/security" },
      { label: "Security Events", href: "/control/security/events" },
      { label: "Restrictions", href: "/control/security/restrictions" },
      { label: "Admin Access", href: "/control/security/admin-access" },
    ],
  },
  {
    section: "operations",
    heading: "Operations",
    items: [
      { label: "Feature Flags", href: "/control/operations" },
      { label: "Maintenance", href: "/control/operations/maintenance" },
      { label: "Status Page", href: "/control/operations/status-page" },
    ],
  },
  {
    section: "administration",
    heading: "Administration",
    items: [
      { label: "Administrators", href: "/control/administration" },
      { label: "Roles", href: "/control/administration/roles" },
      { label: "Audit Logs", href: "/control/administration/audit-logs" },
      { label: "Settings", href: "/control/administration/settings" },
    ],
  },
];

export const metadata = {
  title: "Control Plane — Calder",
};

export default async function ControlLayout({ children }: { children: ReactNode }) {
  const ctx = await requireControl();
  const isFounder = ctx.role === "founder";
  const groups: NavGroup[] = NAV.filter(
    (g) => g.section === "overview" || canAccessSection(ctx.role, g.section as Parameters<typeof canAccessSection>[1])
  ).map((g) => ({ heading: g.heading, items: g.items }));

  return (
    <div className="cp">
      <div className="cp-shell">
        <aside className="cp-sidebar">
          <div className="cp-brand">
            <span
              aria-hidden
              style={{
                width: 10,
                height: 10,
                borderRadius: 999,
                background: "var(--cp-accent)",
                boxShadow: "0 0 12px rgba(61, 90, 254, 0.8)",
                display: "inline-block",
              }}
            />
            <div>
              <div className="cp-brand-name">Calder</div>
              <div className="cp-brand-sub">Control Plane</div>
            </div>
          </div>

          <div className="cp-identity">
            <div className="cp-identity-name" title={ctx.email}>
              {ctx.user.name ?? ctx.email}
            </div>
            <span className="cp-identity-role">
              <span className="cp-dot" aria-hidden />
              {CONTROL_ROLE_LABEL[ctx.role]}
            </span>
          </div>

          <SidebarNav groups={groups} />

          <Link className="cp-exit" href="/">
            ← Open Calder (customer)
          </Link>
        </aside>

        <div className="cp-main">
          <MobileNav groups={groups} />
          <div className="cp-topbar">
            <span className="cp-crumb">
              Calder <span style={{ color: "var(--cp-faint)" }}>/</span> <b>Control Plane</b>
            </span>
            <div className="cp-topbar-right">
              <span className="cp-pill">
                <span
                  className={`cp-dot ${isFounder ? "ok" : "info"}`}
                  aria-hidden
                  style={{ background: isFounder ? "#d4b06a" : undefined }}
                />
                {CONTROL_ROLE_LABEL[ctx.role]}
              </span>
            </div>
          </div>
          <main className="cp-content">{children}</main>
        </div>
      </div>
    </div>
  );
}
