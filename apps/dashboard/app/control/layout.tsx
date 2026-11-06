import type { ReactNode } from "react";
import { canAccessSection, CONTROL_ROLE_LABEL } from "@/lib/control/roles";
import { requireControl } from "@/lib/control/guard";
import { ControlShell } from "./_components/control-shell";
import type { NavGroup } from "./_components/nav";
import "./control.css";

/**
 * Sections visible per role. The sidebar is enforcement-shaped: it renders
 * from ROLE_SECTIONS (the same source the page guards check), so what you
 * see is exactly what you may reach.
 */
const NAV: Array<{
  section: string;
  heading: string;
  items: Array<{ label: string; href: string; exact?: boolean; badge?: string }>;
}> = [
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
      { label: "Company email", href: "/control/communications/company" },
      { label: "Audiences", href: "/control/communications/audiences" },
      { label: "Templates", href: "/control/communications/templates" },
      { label: "Internal delivery", href: "/control/communications/delivery" },
    ],
  },
  {
    section: "billing",
    heading: "Billing",
    items: [
      { label: "Overview", href: "/control/billing" },
      { label: "Subscriptions", href: "/control/billing/subscriptions" },
      { label: "Plans", href: "/control/billing/plans" },
      { label: "Usage records", href: "/control/platform/usage" },
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
      { label: "Capabilities", href: "/control/operations" },
      { label: "Maintenance", href: "/control/operations/maintenance" },
      { label: "Status page", href: "/control/operations/status-page" },
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
  const groups: NavGroup[] = NAV.filter(
    (g) =>
      g.section === "overview" ||
      canAccessSection(ctx.role, g.section as Parameters<typeof canAccessSection>[1]),
  ).map((g) => ({ heading: g.heading, items: g.items }));

  return (
    <ControlShell
      groups={groups}
      name={ctx.user.name ?? ctx.email}
      email={ctx.email}
      roleLabel={CONTROL_ROLE_LABEL[ctx.role]}
    >
      {children}
    </ControlShell>
  );
}
