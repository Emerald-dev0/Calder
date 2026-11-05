"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { activeControlHref } from "@/lib/control/navigation";

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

export function SidebarNav({ groups }: { groups: NavGroup[] }) {
  const pathname = usePathname();
  const activeHref = activeControlHref(
    pathname,
    groups.flatMap((group) => group.items)
  );
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
              data-active={activeHref === item.href}
            >
              <span>{item.label}</span>
              {item.badge ? <span className="cp-nav-badge mono">{item.badge}</span> : null}
            </Link>
          ))}
        </div>
      ))}
    </nav>
  );
}

export function MobileNav({ groups }: { groups: NavGroup[] }) {
  const pathname = usePathname();
  const flat = groups.flatMap((g) => g.items);
  const activeHref = activeControlHref(pathname, flat);
  return (
    <nav aria-label="Control Plane compact" className="cp-mobiletabs">
      {flat.map((item) => (
        <Link key={item.href} href={item.href} data-active={activeHref === item.href}>
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
