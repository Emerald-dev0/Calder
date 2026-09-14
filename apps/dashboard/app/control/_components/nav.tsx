"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

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

function isActive(pathname: string, item: NavItem): boolean {
  if (item.exact) return pathname === item.href;
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

export function SidebarNav({ groups }: { groups: NavGroup[] }) {
  const pathname = usePathname();
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
              data-active={isActive(pathname, item)}
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
  return (
    <nav aria-label="Control Plane compact" className="cp-mobiletabs">
      {flat.map((item) => (
        <Link key={item.href} href={item.href} data-active={isActive(pathname, item)}>
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
