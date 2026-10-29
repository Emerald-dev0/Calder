"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { activeControlHref } from "../../../lib/control/navigation";

export interface NavItem {
  label: string;
  href: string;
  exact?: boolean;
  badge?: string;
}

export interface NavGroup {
  heading: string;
  items: NavItem[];
}

export function SidebarNav({
  groups,
  collapsed = false,
}: {
  groups: NavGroup[];
  collapsed?: boolean;
}) {
  const pathname = usePathname();
  const [query, setQuery] = useState("");
  const active = activeControlHref(
    pathname,
    groups.flatMap((g) => g.items)
  );
  const filtered = groups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) =>
        `${group.heading} ${item.label}`.toLowerCase().includes(query.trim().toLowerCase())
      ),
    }))
    .filter((group) => group.items.length);
  function links(group: NavGroup) {
    return group.items.map((item) => (
      <Link
        key={item.href}
        href={item.href}
        className="cp-nav-link"
        data-active={active === item.href}
        aria-current={active === item.href ? "page" : undefined}
        title={item.label}
      >
        <span className="cp-mark" aria-hidden>
          {item.label.slice(0, 2).toUpperCase()}
        </span>
        <span>{item.label}</span>
        {item.badge ? <span className="cp-nav-badge mono">{item.badge}</span> : null}
      </Link>
    ));
  }
  return (
    <nav aria-label="Control Plane">
      {!collapsed ? (
        <label className="cp-nav-search">
          <span>Find a workspace</span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search pages…"
          />
        </label>
      ) : null}
      {(collapsed ? groups : filtered).map((group) =>
        collapsed ? (
          <div key={group.heading}>{links(group)}</div>
        ) : (
          <details
            className="cp-nav-section"
            key={`${group.heading}:${pathname}:${query}`}
            open={
              Boolean(query.trim()) ||
              group.items.some((item) => item.href === active) ||
              group.heading === "Overview"
            }
          >
            <summary>
              {group.heading}
              <span className="cp-nav-count">{group.items.length}</span>
            </summary>
            {links(group)}
          </details>
        )
      )}
      {!collapsed && filtered.length === 0 ? (
        <p className="cp-nav-empty">No matching pages.</p>
      ) : null}
    </nav>
  );
}

export function MobileNav({ groups }: { groups: NavGroup[] }) {
  const pathname = usePathname();
  const active = activeControlHref(
    pathname,
    groups.flatMap((g) => g.items)
  );
  const label = groups.flatMap((g) => g.items).find((item) => item.href === active)?.label;
  return (
    <details key={pathname} className="cp-mobilemenu">
      <summary>
        Navigate workspace <span>{label ?? "Control Plane"}</span>
      </summary>
      <SidebarNav groups={groups} />
    </details>
  );
}
