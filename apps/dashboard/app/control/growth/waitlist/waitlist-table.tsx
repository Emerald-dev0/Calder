"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { fmtAgo, fmtInt } from "@/lib/control/format";
import { Badge, Dot } from "@/control/_components/ui";

const STATUS_TONE: Record<string, "ok" | "warn" | "info" | "idle" | "bad"> = {
  waiting: "idle",
  invited: "info",
  contacted: "warn",
  converted: "ok",
  removed: "bad",
};

export interface WaitlistTableRow {
  id: string;
  email: string;
  firstName: string | null;
  createdAt: string;
  source: string | null;
  country: string | null;
  referredBy: string | null;
  status: string;
  tags: string[];
}

function initialsOf(name: string | null, email: string): string {
  if (name && name.trim().length > 0) {
    return name
      .trim()
      .split(/\s+/)
      .map((p) => p[0])
      .filter(Boolean)
      .slice(0, 2)
      .join("")
      .toUpperCase();
  }
  return email.slice(0, 2).toUpperCase();
}

/**
 * Waitlist table (REQ-056..058): row hover, real status badges, bulk
 * selection with an honest action set (export of the shown results —
 * the only bulk operation the backend supports today), working pagination.
 */
export function WaitlistTable({
  rows,
  total,
  page,
  pages,
  perPage,
  query,
  basePath,
}: {
  rows: WaitlistTableRow[];
  total: number;
  page: number;
  pages: number;
  perPage: number;
  query: Record<string, string | undefined>;
  basePath: string;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const now = useMemo(() => new Date(), []);

  const pageLink = (p: number) => {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) if (v) sp.set(k, v);
    sp.set("page", String(p));
    return `${basePath}?${sp.toString()}`;
  };

  const exportParams = () => {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) if (v) sp.set(k, v);
    return sp.toString();
  };

  function toggleAll() {
    setSelected((prev) => (prev.size === rows.length ? new Set() : new Set(rows.map((r) => r.id))));
  }

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  if (rows.length === 0) {
    return (
      <div className="cp-empty">
        <b>No matches</b>
        Nothing in the waitlist matches your search or filters.
      </div>
    );
  }

  return (
    <>
      {selected.size > 0 ? (
        <div
          className="cp-filters"
          style={{ padding: "10px 16px", borderBottom: "1px solid var(--cp-border-soft)", margin: 0 }}
        >
          <b style={{ fontSize: 12.5 }}>{selected.size} selected</b>
          <Link className="cp-btn" href={`/control/growth/waitlist/export?${exportParams()}`}>
            Export CSV
          </Link>
          <span style={{ fontSize: 11.5, color: "var(--cp-faint)" }}>
            Exports respect the active filters and your permissions.
          </span>
        </div>
      ) : null}
      <div style={{ overflowX: "auto" }}>
        <table className="cp-table">
          <thead>
            <tr>
              <th style={{ width: 34 }}>
                <input
                  type="checkbox"
                  aria-label="Select all shown"
                  checked={selected.size === rows.length}
                  onChange={toggleAll}
                />
              </th>
              <th>Person</th>
              <th>Email</th>
              <th>Joined</th>
              <th>Source</th>
              <th>Country</th>
              <th>Referral</th>
              <th>Status</th>
              <th aria-label="Open" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const exact = new Date(r.createdAt);
              return (
                <tr key={r.id}>
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`Select ${r.email}`}
                      checked={selected.has(r.id)}
                      onChange={() => toggleOne(r.id)}
                    />
                  </td>
                  <td>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 9 }}>
                      <span className="cp-avatar" aria-hidden>
                        {initialsOf(r.firstName, r.email)}
                      </span>
                      <Link href={`/control/growth/waitlist/${r.id}`}>
                        {r.firstName ?? <span style={{ color: "var(--cp-muted)" }}>Unnamed</span>}
                      </Link>
                    </span>
                  </td>
                  <td className="mono" style={{ fontSize: 12.5 }}>
                    <Link href={`/control/growth/waitlist/${r.id}`}>{r.email}</Link>
                  </td>
                  <td
                    className="mono"
                    style={{ fontSize: 12.5, color: "var(--cp-muted)" }}
                    title={exact.toISOString()}
                  >
                    {fmtAgo(exact, now)}
                  </td>
                  <td style={{ color: "var(--cp-muted)" }}>{r.source ?? "direct"}</td>
                  <td style={{ color: "var(--cp-muted)" }}>{r.country ?? "—"}</td>
                  <td className="mono" style={{ fontSize: 12.5 }}>
                    {r.referredBy ? (
                      <Badge tone="accent">
                        <span className="mono">{r.referredBy}</span>
                      </Badge>
                    ) : (
                      <span style={{ color: "var(--cp-faint)" }}>organic</span>
                    )}
                  </td>
                  <td>
                    <Badge tone={STATUS_TONE[r.status] === "ok" ? "ok" : undefined}>
                      <Dot tone={STATUS_TONE[r.status] ?? "idle"} /> {r.status}
                    </Badge>
                  </td>
                  <td>
                    <Link
                      href={`/control/growth/waitlist/${r.id}`}
                      aria-label={`Open ${r.email}`}
                      style={{ color: "var(--cp-faint)" }}
                    >
                      →
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="cp-pager">
        <span>
          Showing {(page - 1) * perPage + 1}–{Math.min(page * perPage, total)} of {fmtInt(total)}
        </span>
        <span style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          {page > 1 ? (
            <Link href={pageLink(page - 1)}>
              ← Prev
            </Link>
          ) : null}
          {page < pages ? (
            <Link href={pageLink(page + 1)}>
              Next →
            </Link>
          ) : null}
        </span>
      </div>
    </>
  );
}
