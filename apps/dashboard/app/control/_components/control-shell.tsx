"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalderLockup } from "@calder/ui";
import {
  Activity,
  BarChart3,
  Bell,
  BookOpen,
  Building2,
  ChevronUp,
  CreditCard,
  FileCode2,
  LayoutDashboard,
  Menu,
  Megaphone,
  PanelLeftClose,
  PanelLeftOpen,
  Server,
  Settings,
  ShieldAlert,
  Users,
  Webhook,
  X,
} from "lucide-react";
import { activeControlHref } from "@/lib/control/navigation";
import { Avatar, Kbd, ShortcutsDialog, ThemeToggle } from "@/components/design-system";
import type { NavGroup } from "./nav";

function groupIcon(heading: string) {
  const p = { size: 16 };
  switch (heading) {
    case "Overview":
      return <LayoutDashboard {...p} />;
    case "Growth":
      return <Megaphone {...p} />;
    case "Customers":
      return <Users {...p} />;
    case "Communications":
      return <FileCode2 {...p} />;
    case "Billing":
      return <CreditCard {...p} />;
    case "Platform":
      return <Webhook {...p} />;
    case "Infrastructure":
      return <Server {...p} />;
    case "Observability":
      return <BarChart3 {...p} />;
    case "Security":
      return <ShieldAlert {...p} />;
    case "Operations":
      return <Activity {...p} />;
    case "Administration":
      return <Settings {...p} />;
    default:
      return <Building2 {...p} />;
  }
}

export function ControlShell({
  groups,
  name,
  email,
  roleLabel,
  children,
}: {
  groups: NavGroup[];
  name: string;
  email: string;
  roleLabel: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = React.useState(false);
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const [shortcutsOpen, setShortcutsOpen] = React.useState(false);
  const [userMenuOpen, setUserMenuOpen] = React.useState(false);
  const [notifOpen, setNotifOpen] = React.useState(false);
  const userMenuRef = React.useRef<HTMLDivElement>(null);
  const notifRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    try {
      if (window.localStorage.getItem("calder_cp_sidebar_collapsed") === "1") setCollapsed(true);
    } catch {
      // ignore storage errors
    }
  }, []);
  React.useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);
  React.useEffect(() => {
    const onClickOutside = (e: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node))
        setUserMenuOpen(false);
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) setNotifOpen(false);
    };
    window.addEventListener("mousedown", onClickOutside);
    return () => window.removeEventListener("mousedown", onClickOutside);
  }, []);
  React.useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const inInput =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable);
      if (!inInput && e.key === "?") {
        e.preventDefault();
        setShortcutsOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  function toggleCollapsed() {
    setCollapsed((prev) => {
      try {
        window.localStorage.setItem("calder_cp_sidebar_collapsed", prev ? "0" : "1");
      } catch {
        // ignore storage errors
      }
      return !prev;
    });
  }

  const flat = groups.flatMap((g) => g.items.map((i) => ({ ...i, group: g.heading })));
  const activeHref = activeControlHref(
    pathname,
    groups.flatMap((g) => g.items),
  );
  const active = flat.find((i) => i.href === activeHref) ?? flat[0];
  const displayName = name?.trim() || email.split("@")[0] || "Operator";

  return (
    <div className="shell-root cp-unified">
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

      <aside
        className={`shell-sidebar ${collapsed ? "is-collapsed" : ""} ${mobileOpen ? "is-mobile-open" : ""}`}
        aria-label="Control Plane navigation"
      >
        <div className="shell-sidebar-header">
          <div className="shell-brand-row">
            <Link
              href="/control"
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
          {!collapsed && (
            <div
              style={{
                marginTop: 10,
                padding: "8px 10px",
                borderRadius: "var(--radius-md)",
                border: "1px solid var(--color-border)",
                background: "var(--color-surface)",
                fontSize: 12,
                color: "var(--color-muted)",
              }}
            >
              <span style={{ fontWeight: 600, color: "var(--color-ink)" }}>Control Plane</span>
              <span style={{ marginLeft: 6 }}>· {roleLabel}</span>
            </div>
          )}
        </div>

        <nav aria-label="Control Plane" className="shell-nav-scroll">
          {groups.map((group) => (
            <div key={group.heading} className="shell-nav-group">
              {!collapsed && <div className="shell-nav-heading">{group.heading}</div>}
              {group.items.map((item) => {
                const activeItem = activeHref === item.href;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`shell-nav-link ${activeItem ? "is-active" : ""}`}
                    title={collapsed ? item.label : undefined}
                  >
                    <span className="shell-nav-icon">{groupIcon(group.heading)}</span>
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
                        {item.badge ? <span className="shell-nav-tier">{item.badge}</span> : null}
                      </>
                    )}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="shell-sidebar-footer" ref={userMenuRef}>
          <div style={{ position: "relative" }}>
            <button
              type="button"
              onClick={() => setUserMenuOpen((v) => !v)}
              className="shell-user-btn"
              aria-expanded={userMenuOpen}
            >
              <Avatar name={displayName} email={email} size={30} />
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
                      style={{
                        display: "block",
                        fontSize: 11,
                        color: "var(--color-muted)",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {email}
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
                  href="/"
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
                  <LayoutDashboard size={14} style={{ color: "var(--color-muted)" }} />
                  <span>Customer dashboard</span>
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
                  <span style={{ fontSize: 12.5 }}>Keyboard shortcuts</span>
                  <Kbd>?</Kbd>
                </button>
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
                  <span>API docs & SDKs</span>
                </Link>
                <div
                  style={{ borderTop: "1px solid var(--color-border)", marginTop: 6, paddingTop: 6 }}
                >
                  <form action="/api/auth/logout" method="POST" style={{ margin: 0 }}>
                    <button
                      type="submit"
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
                      Sign out
                    </button>
                  </form>
                </div>
              </div>
            )}
          </div>
        </div>
      </aside>

      <div className="shell-main-col">
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
            <nav
              aria-label="Breadcrumb"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                fontSize: 12.5,
                color: "var(--color-muted)",
                minWidth: 0,
              }}
            >
              <span style={{ whiteSpace: "nowrap" }}>Control Plane</span>
              <span aria-hidden style={{ opacity: 0.45 }}>
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
                {active?.label ?? "Overview"}
              </span>
            </nav>
          </div>
          <div className="shell-topbar-right">
            <span
              className="mono"
              style={{
                fontSize: 11,
                color: "var(--color-muted)",
                border: "1px solid var(--color-border)",
                borderRadius: 999,
                padding: "4px 10px",
                background: "var(--color-surface)",
              }}
            >
              {roleLabel}
            </span>
            <div ref={notifRef} style={{ position: "relative" }}>
              <button
                type="button"
                onClick={() => setNotifOpen((v) => !v)}
                className="ds-btn ds-btn-ghost ds-btn-icon ds-btn-sm"
                aria-label="Notifications"
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
                    fontSize: 12,
                    color: "var(--color-muted)",
                  }}
                >
                  Operational alerts surface on the Command Center and Observability pages.
                </div>
              )}
            </div>
            <ThemeToggle compact />
          </div>
        </header>
        <main className="shell-page-container cp-content">{children}</main>
      </div>

      <ShortcutsDialog open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />

      <style>{`
        @media (max-width: 1023px) {
          .cp-unified .shell-mobile-trigger { display: inline-flex !important; }
        }
      `}</style>
    </div>
  );
}
