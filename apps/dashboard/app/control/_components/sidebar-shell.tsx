"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { NavGroup } from "./nav";

function isActive(pathname: string, href: string, exact?: boolean): boolean {
  if (exact) return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

const COLLAPSE_KEY = "cp-sidebar-collapsed";

/**
 * Control Plane sidebar shell (SRS REQ-001..004).
 *
 * - Grouped nav from the same source the guards check (role-enforcement-shaped).
 * - Active item: subtle tint + inset cobalt bar. No solid accent blocks.
 * - Collapse: 68px rail of two-letter group marks; hover shows the page name
 *   via title tooltip; state persists in localStorage.
 * - Founder profile footer with Account / Control Plane / Sign out popover.
 */
export function SidebarShell({
  groups,
  name,
  email,
  roleLabel,
  exitHref = "/",
  children,
}: {
  groups: NavGroup[];
  name: string;
  email: string;
  roleLabel: string;
  exitHref?: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const popRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(COLLAPSE_KEY) === "1");
    } catch {
      /* private mode */
    }
  }, []);

  useEffect(() => {
    if (!profileOpen) return;
    const close = (e: MouseEvent) => {
      if (popRef.current && !popRef.current.contains(e.target as Node)) setProfileOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [profileOpen]);

  function toggle() {
    setCollapsed((c) => {
      try {
        localStorage.setItem(COLLAPSE_KEY, c ? "0" : "1");
      } catch {
        /* private mode */
      }
      return !c;
    });
  }

  const initials = name
    .split(/\s+/)
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <div className="cp-shell">
      <aside className="cp-sidebar" data-collapsed={collapsed}>
        <div className="cp-sidebar-inner">
          <div className="cp-brand">
            <span
              aria-hidden
              style={{
                width: 10,
                height: 10,
                borderRadius: 999,
                background: "var(--cp-accent)",
                display: "inline-block",
                flexShrink: 0,
              }}
            />
            <div className="cp-brand-text">
              <div className="cp-brand-name">Calder</div>
              <div className="cp-brand-sub">Control Plane</div>
            </div>
            <button
              type="button"
              className="cp-nav-toggle"
              onClick={toggle}
              aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              style={{ marginLeft: "auto" }}
            >
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path
                  d={collapsed ? "M6 3l5 5-5 5" : "M10 3L5 8l5 5"}
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          </div>

          <SidebarNav
            groups={groups}
            pathname={pathname}
          />

          <div className="cp-nav-spacer" />

          <div className="cp-profile" ref={popRef}>
            <button
              type="button"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                width: "100%",
                background: "none",
                border: "none",
                padding: 0,
                cursor: "pointer",
                textAlign: "left",
              }}
              onClick={() => setProfileOpen((o) => !o)}
              aria-expanded={profileOpen}
            >
              <span className="cp-avatar" aria-hidden>
                {initials || "F"}
              </span>
              <span style={{ minWidth: 0 }}>
                <span className="cp-profile-name">{name}</span>
                <span className="cp-profile-role" style={{ display: "block" }}>
                  {roleLabel} · Owner
                </span>
              </span>
            </button>
            {profileOpen ? (
              <div className="cp-profile-pop">
                <Link href="/control/administration/settings">Account</Link>
                <Link href="/">Control Plane exit</Link>
                <form action="/api/auth/logout" method="POST">
                  <button type="submit">Sign out</button>
                </form>
              </div>
            ) : null}
          </div>

          <Link className="cp-exit" href={exitHref}>
            ← Open Calder (customer)
          </Link>
          {collapsed ? <span title={email} style={{ position: "absolute" }} /> : null}
        </div>
      </aside>
      <div className="cp-main">{children}</div>
    </div>
  );
}

function SidebarNav({ groups, pathname }: { groups: NavGroup[]; pathname: string }) {
  return (
    <nav aria-label="Control Plane" style={{ display: "block" }}>
      {groups.map((group) => (
        <div key={group.heading}>
          <div className="cp-nav-group">{group.heading}</div>
          {group.items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="cp-nav-link"
              data-active={isActive(pathname, item.href, item.exact)}
              title={item.label}
            >
              <span className="cp-mark" aria-hidden>
                {group.heading.slice(0, 2).toUpperCase()}
              </span>
              <span>{item.label}</span>
              {item.badge ? <span className="cp-nav-badge mono">{item.badge}</span> : null}
            </Link>
          ))}
        </div>
      ))}
    </nav>
  );
}
