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
  Radio,
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
      {/* Mobile overlay backdrop */}
      {mobileOpen && (
        <div
          onClick={() => setMobileOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(11, 12, 14, 0.55)",
            backdropFilter: "blur(3px)",
            zIndex: 45,
          }}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`shell-sidebar ${collapsed ? "is-collapsed" : ""} ${mobileOpen ? "is-mobile-open" : ""}`}
        aria-label="Primary Sidebar"
      >
        <div className="shell-sidebar-header">
          <div className="shell-brand-row">
            <Link
              href={withProject("/")}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                textDecoration: "none",
                color: "var(--color-ink)",
                overflow: "hidden",
              }}
            >
              <span className="shell-brand">
                <CalderLockup size={20} />
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

        {/* Scrollable Navigation */}
        <nav aria-label="Dashboard" className="shell-nav-scroll">
          {navGroups.map((group) => (
            <div key={group.heading} className="shell-nav-group">
              {group.heading && !collapsed && (
                <div className="shell-nav-heading">{group.heading}</div>
              )}
              {group.items.map((item) => {
                const active = isItemActive(item.href);
                return (
                  <Link
                    key={item.label}
                    href={withProject(item.href)}
                    className={`shell-nav-link ${active ? "is-active" : ""}`}
                    title={collapsed ? item.label : undefined}
                  >
                    <span className="shell-nav-icon">{item.icon}</span>
                    {!collapsed && (
                      <>
                        <span
                          style={{
                            flex: 1,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {item.label}
                        </span>
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

        {/* Sticky Sidebar Footer: Plan Usage + User Profile */}
        <div className="shell-sidebar-footer" ref={userMenuRef}>
          {!collapsed && (
            <div className="shell-usage-box">
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  fontSize: 11.5,
                }}
              >
                <span style={{ fontWeight: 600, color: "var(--color-ink)" }}>
                  {usageSummary.planName} Plan
                </span>
                <Link
                  href="/usage"
                  style={{
                    fontSize: 11,
                    color: "var(--color-accent)",
                    textDecoration: "none",
                    fontWeight: 600,
                  }}
                >
                  Manage →
                </Link>
              </div>
              <div className="shell-usage-bar">
                <div
                  className="shell-usage-fill"
                  style={{
                    width: `${Math.max(2, usagePct)}%`,
                    background:
                      usagePct >= 90 ? "var(--color-danger)" : "var(--color-accent)",
                  }}
                />
              </div>
              <div
                className="mono tabular-nums"
                style={{
                  fontSize: 11,
                  color: "var(--color-muted)",
                  display: "flex",
                  justifyContent: "space-between",
                }}
              >
                <span>
                  {usageSummary.sentThisMonth.toLocaleString()} /{" "}
                  {usageSummary.monthlyQuota.toLocaleString()} emails
                </span>
                <span>{usagePct}%</span>
              </div>
            </div>
          )}

          {/* User Profile Popover Menu */}
          <div style={{ position: "relative" }}>
            <button
              type="button"
              onClick={() => setUserMenuOpen((v) => !v)}
              className="shell-user-btn"
              title={`${displayName} (${user.email})`}
              aria-expanded={userMenuOpen}
              aria-label="Open account menu"
            >
              <Avatar name={displayName} email={user.email} size={30} />
              {!collapsed && (
                <>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span
                      style={{
                        display: "block",
                        fontSize: 12.5,
                        fontWeight: 600,
                        color: "var(--color-ink)",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {displayName}
                    </span>
                    <span
                      className="mono"
                      title={user.email}
                      style={{
                        display: "block",
                        fontSize: 11,
                        color: "var(--color-muted)",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
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
              <div
                style={{
                  position: "absolute",
                  bottom: "calc(100% + 8px)",
                  left: 0,
                  width: 256,
                  background: "var(--color-surface)",
                  border: "1px solid var(--color-border)",
                  borderRadius: "var(--radius-lg)",
                  boxShadow: "var(--shadow-lg)",
                  padding: 8,
                  zIndex: 80,
                }}
              >
                <div
                  style={{
                    padding: "6px 8px 10px",
                    borderBottom: "1px solid var(--color-border)",
                    marginBottom: 6,
                  }}
                >
                  <div style={{ fontSize: 13, fontWeight: 700, color: "var(--color-ink)" }}>
                    {displayName}
                  </div>
                  <div
                    className="mono"
                    style={{
                      fontSize: 11.5,
                      color: "var(--color-muted)",
                      wordBreak: "break-all",
                      marginTop: 2,
                    }}
                  >
                    {user.email}
                  </div>
                </div>

                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "6px 8px",
                    fontSize: 12,
                    color: "var(--color-muted)",
                  }}
                >
                  <span>Theme</span>
                  <ThemeToggle compact />
                </div>

                <Link
                  href="/settings"
                  onClick={() => setUserMenuOpen(false)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "7px 8px",
                    borderRadius: "var(--radius-md)",
                    textDecoration: "none",
                    fontSize: 12.5,
                    color: "var(--color-ink)",
                  }}
                >
                  <Settings size={14} style={{ color: "var(--color-muted)" }} />
                  <span>Account & Workspace</span>
                </Link>

                <button
                  type="button"
                  onClick={() => {
                    setUserMenuOpen(false);
                    setShortcutsOpen(true);
                  }}
                  style={{
                    width: "100%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 8,
                    padding: "7px 8px",
                    borderRadius: "var(--radius-md)",
                    border: "none",
                    background: "transparent",
                    fontSize: 12.5,
                    color: "var(--color-ink)",
                    cursor: "pointer",
                    textAlign: "left",
                  }}
                >
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                    <Keyboard size={14} style={{ color: "var(--color-muted)" }} />
                    <span>Keyboard Shortcuts</span>
                  </span>
                  <Kbd>?</Kbd>
                </button>

                <Link
                  href="/dev/design-system"
                  onClick={() => setUserMenuOpen(false)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "7px 8px",
                    borderRadius: "var(--radius-md)",
                    textDecoration: "none",
                    fontSize: 12.5,
                    color: "var(--color-ink)",
                  }}
                >
                  <Palette size={14} style={{ color: "var(--color-muted)" }} />
                  <span>Design System</span>
                </Link>

                <Link
                  href="/sdks"
                  onClick={() => setUserMenuOpen(false)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "7px 8px",
                    borderRadius: "var(--radius-md)",
                    textDecoration: "none",
                    fontSize: 12.5,
                    color: "var(--color-ink)",
                  }}
                >
                  <BookOpen size={14} style={{ color: "var(--color-muted)" }} />
                  <span>API Docs & SDKs</span>
                </Link>

                <div
                  style={{
                    borderTop: "1px solid var(--color-border)",
                    marginTop: 6,
                    paddingTop: 6,
                  }}
                >
                  <form action="/api/auth/logout" method="POST" style={{ margin: 0 }}>
                    <button
                      type="submit"
                      className="dash-signout"
                      style={{
                        width: "100%",
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        padding: "7px 8px",
                        borderRadius: "var(--radius-md)",
                        border: "none",
                        background: "transparent",
                        color: "var(--color-danger)",
                        fontSize: 12.5,
                        fontWeight: 600,
                        cursor: "pointer",
                        textAlign: "left",
                      }}
                    >
                      <LogOut size={14} />
                      <span>Sign out</span>
                    </button>
                  </form>
                </div>
              </div>
            )}
          </div>
        </div>
      </aside>

      {/* Main Column */}
      <div className="shell-main-col">
        {/* Unmistakable Test Mode Top Strip */}
        {envMode === "test" && (
          <div
            role="status"
            style={{
              background: "var(--color-warning-bg)",
              borderBottom: "1px solid var(--color-warning-border)",
              color: "var(--color-warning)",
              padding: "6px 20px",
              fontSize: 12,
              fontWeight: 600,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
              <FlaskConical size={14} />
              <span>
                <b>SANDBOX TEST MODE ACTIVE</b> — Emails and webhook payloads are simulated in-memory and will not be delivered to external recipients.
              </span>
            </span>
            <button
              type="button"
              onClick={toggleEnvMode}
              className="mono"
              style={{
                appearance: "none",
                background: "var(--color-surface)",
                color: "var(--color-ink)",
                border: "1px solid var(--color-warning-border)",
                borderRadius: 6,
                padding: "2px 8px",
                fontSize: 11,
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              Switch to Live Mode →
            </button>
          </div>
        )}

        {/* Sticky Topbar */}
        <header className="shell-topbar">
          <div className="shell-topbar-left">
            <button
              type="button"
              onClick={() => setMobileOpen((v) => !v)}
              className="ds-btn ds-btn-ghost ds-btn-icon ds-btn-sm shell-mobile-trigger"
              aria-label="Toggle navigation drawer"
              style={{ display: "none" }}
            >
              {mobileOpen ? <X size={18} /> : <Menu size={18} />}
            </button>

            {/* Breadcrumbs */}
            <nav
              aria-label="Breadcrumb"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                fontSize: 12.5,
                color: "var(--color-muted)",
                minWidth: 0,
                overflow: "hidden",
              }}
            >
              <Link
                href={withProject("/")}
                className="shell-crumb-org"
                style={{
                  color: "var(--color-muted)",
                  textDecoration: "none",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {currentOrgName}
              </Link>
              <span className="shell-crumb-sep" aria-hidden="true" style={{ opacity: 0.45 }}>
                /
              </span>
              <span
                style={{
                  color: "var(--color-ink)",
                  fontWeight: 600,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {activeEntry.item.label}
              </span>
            </nav>
          </div>

          <div className="shell-topbar-right">
            {/* Global Command Palette Trigger */}
            <button
              type="button"
              onClick={() => setCmdOpen(true)}
              className="shell-cmd-trigger"
              aria-label="Search or run command (Cmd+K)"
            >
              <Search size={14} />
              <span style={{ flex: 1, textAlign: "left" }}>Search or jump to…</span>
              <Kbd>⌘K</Kbd>
            </button>

            {/* Environment Mode Switch (Live / Test) */}
            <button
              type="button"
              onClick={toggleEnvMode}
              title="Toggle between Live production mode and Sandbox Test mode"
              style={{
                appearance: "none",
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                height: 32,
                padding: "0 10px",
                borderRadius: "var(--radius-md)",
                border: `1px solid ${
                  envMode === "test"
                    ? "var(--color-warning-border)"
                    : "var(--color-border)"
                }`,
                background:
                  envMode === "test"
                    ? "var(--color-warning-bg)"
                    : "var(--color-surface-elevated)",
                color:
                  envMode === "test"
                    ? "var(--color-warning)"
                    : "var(--color-ink-secondary)",
                fontSize: 12,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              {envMode === "test" ? (
                <>
                  <FlaskConical size={13} />
                  <span>Test mode</span>
                </>
              ) : (
                <>
                  <Radio size={13} style={{ color: "var(--color-success)" }} />
                  <span>Live</span>
                </>
              )}
            </button>

            {/* Notifications Bell */}
            <div ref={notifRef} style={{ position: "relative" }}>
              <button
                type="button"
                onClick={() => setNotifOpen((v) => !v)}
                className="ds-btn ds-btn-ghost ds-btn-icon ds-btn-sm"
                aria-label="Notifications"
                title="System notifications"
              >
                <Bell size={15} />
              </button>
              {notifOpen && (
                <div
                  style={{
                    position: "absolute",
                    top: "calc(100% + 8px)",
                    right: 0,
                    width: 310,
                    background: "var(--color-surface)",
                    border: "1px solid var(--color-border)",
                    borderRadius: "var(--radius-lg)",
                    boxShadow: "var(--shadow-lg)",
                    padding: 12,
                    zIndex: 80,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      marginBottom: 8,
                    }}
                  >
                    <span style={{ fontSize: 12.5, fontWeight: 700 }}>Notifications</span>
                    <span className="mono" style={{ fontSize: 11, color: "var(--color-muted)" }}>
                      All caught up
                    </span>
                  </div>
                  <div
                    style={{
                      padding: "14px 10px",
                      borderRadius: "var(--radius-md)",
                      background: "var(--color-surface-elevated)",
                      fontSize: 12,
                      color: "var(--color-muted)",
                      textAlign: "center",
                    }}
                  >
                    No bounce spikes, webhook failures, or DNS alerts in the last 24 hours.
                  </div>
                </div>
              )}
            </div>

            {/* Quick Docs Link */}
            <Link
              href="/sdks"
              className="ds-btn ds-btn-ghost ds-btn-icon ds-btn-sm"
              title="SDKs & API Documentation"
              aria-label="SDKs & API Documentation"
            >
              <BookOpen size={15} />
            </Link>
          </div>
        </header>

        {/* Page Main Container */}
        <main className="shell-page-container">{children}</main>
      </div>

      {/* Overlays */}
      <CommandPalette open={cmdOpen} onClose={() => setCmdOpen(false)} />
      <ShortcutsDialog open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
      <ProUpgradeModal
        open={proModal.open}
        onClose={() => setProModal({ open: false })}
        featureTitle={proModal.title}
      />

      <style>{`
        @media (max-width: 1023px) {
          .shell-mobile-trigger {
            display: inline-flex !important;
          }
          .shell-cmd-trigger {
            min-width: auto !important;
            padding: 0 10px !important;
          }
          .shell-cmd-trigger span {
            display: none;
          }
        }
      `}</style>
    </div>
  );
}
