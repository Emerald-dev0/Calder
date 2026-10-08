"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CalderLockup } from "@calder/ui";
import {
  LayoutDashboard,
  Mail,
  Send,
  FileCode2,
  UserCheck,
  Globe,
  ShieldBan,
  BarChart3,
  Inbox,
  Webhook,
  KeyRound,
  Code2,
  Server,
  ScrollText,
  Puzzle,
  Gauge,
  History,
  Settings,
  ShieldAlert,
  Search,
  PanelLeftClose,
  PanelLeftOpen,
  Menu,
  X,
  Bell,
  BookOpen,
  LogOut,
  Keyboard,
  FlaskConical,
  Palette,
  ChevronUp,
} from "lucide-react";
import { ContextSwitcher, type ContextMembership } from "./context-switcher";
import {
  Avatar,
  Kbd,
  ThemeToggle,
  CommandPalette,
  ShortcutsDialog,
  ProUpgradeModal,
} from "./design-system";

export interface ShellProps {
  user: {
    userId: string;
    email: string;
    name?: string | null;
  };
  memberships: ContextMembership[];
  showAdmin: boolean;
  usageSummary: {
    sentThisMonth: number;
    monthlyQuota: number;
    planName: string;
    verifiedDomains: number;
    activeKeys: number;
  };
  children: React.ReactNode;
}

interface NavItem {
  label: string;
  href: string;
  icon: React.ReactNode;
  tier?: "PRO" | "PREMIUM" | "SCALE";
  founder?: boolean;
  badge?: string | number;
  badgeWarn?: boolean;
}

interface NavGroup {
  heading: string;
  items: NavItem[];
}

export function AppShell({
  user,
  memberships,
  showAdmin,
  usageSummary,
  children,
}: ShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [collapsed, setCollapsed] = React.useState(false);
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const [cmdOpen, setCmdOpen] = React.useState(false);
  const [shortcutsOpen, setShortcutsOpen] = React.useState(false);
  const [proModal, setProModal] = React.useState<{ open: boolean; title?: string }>({
    open: false,
  });
  const [userMenuOpen, setUserMenuOpen] = React.useState(false);
  const [notifOpen, setNotifOpen] = React.useState(false);
  const [envMode, setEnvMode] = React.useState<"live" | "test">("live");

  const userMenuRef = React.useRef<HTMLDivElement>(null);
  const notifRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    try {
      const savedCollapsed = window.localStorage.getItem("calder_sidebar_collapsed");
      if (savedCollapsed === "1") setCollapsed(true);
      const savedMode = window.localStorage.getItem("calder_env_mode");
      if (savedMode === "test" || savedMode === "live") setEnvMode(savedMode);
    } catch {
      // ignore storage errors
    }
  }, []);

  React.useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  React.useEffect(() => {
    const onClickOutside = (e: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setUserMenuOpen(false);
      }
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) {
        setNotifOpen(false);
      }
    };
    window.addEventListener("mousedown", onClickOutside);
    return () => window.removeEventListener("mousedown", onClickOutside);
  }, []);

  // Global keyboard shortcuts (Cmd/Ctrl+K, ?, G+O/E/D/K, C)
  React.useEffect(() => {
    let lastG = 0;
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCmdOpen((v) => !v);
        return;
      }
      const target = e.target as HTMLElement | null;
      const inInput =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable);
      if (inInput) return;

      if (e.key === "?") {
        e.preventDefault();
        setShortcutsOpen((v) => !v);
      } else if (e.key.toLowerCase() === "g") {
        lastG = Date.now();
      } else if (Date.now() - lastG < 900) {
        const k = e.key.toLowerCase();
        if (k === "o") router.push("/");
        if (k === "e") router.push("/emails");
        if (k === "d") router.push("/domains");
        if (k === "k") router.push("/keys");
        lastG = 0;
      } else if (e.key.toLowerCase() === "c" && !e.metaKey && !e.ctrlKey) {
        router.push("/emails/new");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [router]);

  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem("calder_sidebar_collapsed", next ? "1" : "0");
      } catch {
        // ignore
      }
      return next;
    });
  }

  function toggleEnvMode() {
    setEnvMode((prev) => {
      const next = prev === "live" ? "test" : "live";
      try {
        window.localStorage.setItem("calder_env_mode", next);
      } catch {
        // ignore
      }
      return next;
    });
  }

  const projectParam = searchParams.get("project");
  const withProject = React.useCallback(
    (href: string) => {
      if (!projectParam) return href;
      const sep = href.includes("?") ? "&" : "?";
      return `${href}${sep}project=${encodeURIComponent(projectParam)}`;
    },
    [projectParam],
  );

  const navGroups: NavGroup[] = React.useMemo(() => {
    const groups: NavGroup[] = [
      {
        heading: "",
        items: [
          { label: "Overview", href: "/", icon: <LayoutDashboard size={16} /> },
          { label: "Emails", href: "/emails", icon: <Mail size={16} /> },
          { label: "Templates", href: "/templates", icon: <FileCode2 size={16} /> },
          {
            label: "Domains",
            href: "/domains",
            icon: <Globe size={16} />,
            badgeWarn: usageSummary.verifiedDomains === 0 && memberships.length > 0,
          },
          { label: "Analytics", href: "/analytics", icon: <BarChart3 size={16} />, tier: "PRO" },
          { label: "Logs", href: "/logs", icon: <ScrollText size={16} /> },
        ],
      },
      {
        heading: "Developers",
        items: [
          { label: "API keys", href: "/keys", icon: <KeyRound size={16} /> },
          { label: "Webhooks", href: "/webhooks", icon: <Webhook size={16} /> },
          { label: "SMTP", href: "/smtp", icon: <Server size={16} /> },
          { label: "SDKs", href: "/sdks", icon: <Code2 size={16} /> },
          { label: "Integrations", href: "/integrations", icon: <Puzzle size={16} /> },
        ],
      },
      {
        heading: "Deliverability",
        items: [
          { label: "Deliveries", href: "/deliveries", icon: <Send size={16} /> },
          { label: "Senders", href: "/senders", icon: <UserCheck size={16} /> },
          { label: "Suppressions", href: "/suppressions", icon: <ShieldBan size={16} /> },
          { label: "Inbox", href: "/inbox", icon: <Inbox size={16} />, tier: "PRO" },
        ],
      },
      {
        heading: "Organization",
        items: [
          { label: "Usage", href: "/usage", icon: <Gauge size={16} /> },
          { label: "Audit logs", href: "/audit-logs", icon: <History size={16} /> },
          { label: "Settings", href: "/settings", icon: <Settings size={16} /> },
          ...(showAdmin
            ? [
                {
                  label: "Control Plane",
                  href: "/control",
                  icon: <ShieldAlert size={16} />,
                  founder: true,
                },
              ]
            : []),
        ],
      },
    ];
    return groups;
  }, [showAdmin, usageSummary.verifiedDomains, memberships.length]);

  const isItemActive = (href: string) => {
    if (href === "/") return pathname === "/";
    return pathname === href || pathname.startsWith(`${href}/`);
  };

  // Compute Breadcrumbs
  const currentOrgName = memberships[0]?.organization.name ?? "Workspace";
  const activeEntry = React.useMemo(() => {
    for (const g of navGroups) {
      for (const item of g.items) {
        if (isItemActive(item.href)) {
          return { group: g.heading, item };
        }
      }
    }
    if (pathname.startsWith("/dev/design-system")) {
      return {
        group: "DEVELOPER",
        item: { label: "Design System", href: "/dev/design-system", icon: <Palette size={16} /> },
      };
    }
    return { group: "WORKSPACE", item: { label: "Overview", href: "/", icon: null } };
  }, [navGroups, pathname]);

  const displayName =
    user.name?.trim() ||
    user.email
      .split("@")[0]
      ?.replace(/[._-]/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase()) ||
    "Operator";

  const usagePct = Math.min(
    100,
    Math.round((usageSummary.sentThisMonth / Math.max(1, usageSummary.monthlyQuota)) * 100),
  );

  return (
    <div className="shell-root">
      {mobileOpen && (
        <div
          className="shell-backdrop"
          onClick={() => setMobileOpen(false)}
          aria-hidden="true"
        />
      )}

      <aside
        className={`shell-sidebar ${collapsed ? "is-collapsed" : ""} ${mobileOpen ? "is-mobile-open" : ""}`}
        aria-label="Primary sidebar"
      >
        <div className="shell-sidebar-header">
          <div className="shell-brand-row">
            <Link href={withProject("/")} className="shell-brand-link" aria-label="Calder home">
              <span className="shell-brand">
                <CalderLockup size={collapsed ? 18 : 20} />
              </span>
            </Link>
            <button
              type="button"
              onClick={toggleCollapsed}
              className="ds-btn ds-btn-ghost ds-btn-icon ds-btn-sm"
              title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              {collapsed ? <PanelLeftOpen size={15} /> : <PanelLeftClose size={15} />}
            </button>
          </div>

          <ContextSwitcher memberships={memberships} collapsed={collapsed} />
        </div>

        <nav aria-label="Dashboard" className="shell-nav-scroll">
          {navGroups.map((group, gi) => (
            <div key={group.heading || `group-${gi}`} className="shell-nav-group">
              {group.heading && !collapsed && (
                <div className="shell-nav-heading">{group.heading}</div>
              )}
              {group.items.map((item) => {
                const active = isItemActive(item.href);
                return (
                  <Link
                    key={item.label}
                    href={withProject(item.href)}
                    className={`shell-nav-link ${active ? "is-active" : ""} ${item.founder ? "is-founder" : ""}`}
                    title={collapsed ? item.label : undefined}
                    aria-current={active ? "page" : undefined}
                  >
                    <span className="shell-nav-icon">{item.icon}</span>
                    {!collapsed && (
                      <>
                        <span className="shell-nav-label">{item.label}</span>
                        {item.badgeWarn && (
                          <span
                            className="shell-nav-dot"
                            title="Needs setup"
                            aria-label="Needs setup"
                          />
                        )}
                        {item.tier && (
                          <span className="shell-nav-tier">
                            {item.tier === "PRO" ? "Pro" : item.tier}
                          </span>
                        )}
                      </>
                    )}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="shell-sidebar-footer" ref={userMenuRef}>
          {!collapsed && (
            <div className="shell-usage-box">
              <div className="shell-usage-top">
                <span>{usageSummary.planName} plan</span>
                <Link href="/usage">Manage</Link>
              </div>
              <div
                className="shell-usage-bar"
                role="progressbar"
                aria-valuenow={usagePct}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label="Monthly email usage"
              >
                <div
                  className={`shell-usage-fill ${usagePct >= 90 ? "is-danger" : ""}`}
                  style={{ width: `${Math.max(2, usagePct)}%` }}
                />
              </div>
              <div className="shell-usage-meta tabular-nums">
                <span>
                  {usageSummary.sentThisMonth.toLocaleString()} /{" "}
                  {usageSummary.monthlyQuota.toLocaleString()} emails
                </span>
                <span>{usagePct}%</span>
              </div>
            </div>
          )}

          <div className="shell-pop-anchor">
            <button
              type="button"
              onClick={() => setUserMenuOpen((v) => !v)}
              className="shell-user-btn"
              title={`${displayName} (${user.email})`}
              aria-expanded={userMenuOpen}
              aria-haspopup="menu"
              aria-label="Open account menu"
            >
              <Avatar name={displayName} email={user.email} size={30} />
              {!collapsed && (
                <>
                  <span className="shell-user-info">
                    <span className="shell-user-name">{displayName}</span>
                    <span className="shell-user-email mono" title={user.email}>
                      {user.email}
                    </span>
                  </span>
                  <ChevronUp
                    size={14}
                    style={{
                      color: "var(--color-muted)",
                      flexShrink: 0,
                      transform: userMenuOpen ? "rotate(180deg)" : "none",
                      transition: "transform 150ms ease",
                    }}
                  />
                </>
              )}
            </button>

            {userMenuOpen && (
              <div className="shell-pop is-up" role="menu">
                <div className="shell-pop-head">
                  <div className="shell-pop-title">{displayName}</div>
                  <div className="shell-pop-sub mono">{user.email}</div>
                </div>
                <div className="shell-pop-row">
                  <span>Theme</span>
                  <ThemeToggle compact />
                </div>
                <Link
                  href="/settings"
                  onClick={() => setUserMenuOpen(false)}
                  className="shell-menu-item"
                  role="menuitem"
                >
                  <span>
                    <Settings size={14} />
                    Account &amp; workspace
                  </span>
                </Link>
                <button
                  type="button"
                  className="shell-menu-item"
                  role="menuitem"
                  onClick={() => {
                    setUserMenuOpen(false);
                    setShortcutsOpen(true);
                  }}
                >
                  <span>
                    <Keyboard size={14} />
                    Keyboard shortcuts
                  </span>
                  <Kbd>?</Kbd>
                </button>
                <Link
                  href="/sdks"
                  onClick={() => setUserMenuOpen(false)}
                  className="shell-menu-item"
                  role="menuitem"
                >
                  <span>
                    <BookOpen size={14} />
                    API docs &amp; SDKs
                  </span>
                </Link>
                <Link
                  href="/dev/design-system"
                  onClick={() => setUserMenuOpen(false)}
                  className="shell-menu-item"
                  role="menuitem"
                >
                  <span>
                    <Palette size={14} />
                    Design system
                  </span>
                </Link>
                <div className="shell-menu-sep" />
                <form action="/api/auth/logout" method="POST" style={{ margin: 0 }}>
                  <button
                    type="submit"
                    className="shell-menu-item is-danger dash-signout"
                    role="menuitem"
                  >
                    <span>
                      <LogOut size={14} />
                      Sign out
                    </span>
                  </button>
                </form>
              </div>
            )}
          </div>
        </div>
      </aside>

      <div className="shell-main-col">
        {envMode === "test" && (
          <div role="status" className="shell-test-banner">
            <span>
              <FlaskConical size={14} />
              <span>
                <b>Test mode.</b> Emails and webhook payloads are simulated and never delivered to
                real recipients.
              </span>
            </span>
            <button type="button" onClick={toggleEnvMode}>
              Switch to live
            </button>
          </div>
        )}

        <header className="shell-topbar">
          <div className="shell-topbar-left">
            <button
              type="button"
              onClick={() => setMobileOpen((v) => !v)}
              className="ds-btn ds-btn-ghost ds-btn-icon ds-btn-sm shell-mobile-trigger"
              aria-label="Toggle navigation drawer"
            >
              {mobileOpen ? <X size={18} /> : <Menu size={18} />}
            </button>

            <nav aria-label="Breadcrumb" className="shell-crumbs">
              <Link href={withProject("/")} className="shell-crumb-org">
                {currentOrgName}
              </Link>
              <span className="shell-crumb-sep" aria-hidden="true">
                /
              </span>
              <span className="shell-crumb-current" aria-current="page">
                {activeEntry.item.label}
              </span>
            </nav>
          </div>

          <div className="shell-topbar-right">
            <button
              type="button"
              onClick={() => setCmdOpen(true)}
              className="shell-cmd-trigger"
              aria-label="Search or run command (Cmd+K)"
            >
              <Search size={14} />
              <span className="shell-cmd-trigger-label">Search or jump to…</span>
              <Kbd>⌘K</Kbd>
            </button>

            <button
              type="button"
              onClick={toggleEnvMode}
              className={`shell-env-btn ${envMode === "test" ? "is-test" : ""}`}
              title="Switch between live and test mode"
              aria-label={`Environment: ${envMode}. Click to switch.`}
            >
              {envMode === "test" ? (
                <FlaskConical size={13} />
              ) : (
                <span className="shell-env-live" aria-hidden="true" />
              )}
              <span className="shell-env-btn-label">{envMode === "test" ? "Test" : "Live"}</span>
            </button>

            <div ref={notifRef} className="shell-pop-anchor">
              <button
                type="button"
                onClick={() => setNotifOpen((v) => !v)}
                className="ds-btn ds-btn-ghost ds-btn-icon ds-btn-sm"
                aria-label="Notifications"
                aria-expanded={notifOpen}
              >
                <Bell size={15} />
              </button>
              {notifOpen && (
                <div className="shell-pop is-down">
                  <div
                    className="shell-pop-head"
                    style={{ display: "flex", justifyContent: "space-between" }}
                  >
                    <span className="shell-pop-title">Notifications</span>
                    <span className="shell-pop-sub">All caught up</span>
                  </div>
                  <div className="shell-pop-empty">
                    No bounce spikes, webhook failures or DNS alerts in the last 24 hours.
                  </div>
                </div>
              )}
            </div>

            <Link
              href="/sdks"
              className="ds-btn ds-btn-ghost ds-btn-icon ds-btn-sm"
              title="SDKs and API documentation"
              aria-label="SDKs and API documentation"
            >
              <BookOpen size={15} />
            </Link>
          </div>
        </header>

        <main className="shell-page-container">{children}</main>
      </div>

      <CommandPalette open={cmdOpen} onClose={() => setCmdOpen(false)} />
      <ShortcutsDialog open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
      <ProUpgradeModal
        open={proModal.open}
        onClose={() => setProModal({ open: false })}
        featureTitle={proModal.title}
      />
    </div>
  );
}
